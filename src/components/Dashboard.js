import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as XLSX from 'xlsx';
import allocateWorkers from '../services/scheduler';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './Dashboard.css';
import { supabase } from '../supabaseClient';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { createPortal } from 'react-dom';

// SortableItem component for each table cell
// SortableItem component for each table cell
const SortableItem = ({ id, worker, day, daySchedule, stationColor, handleChange, setFocusedFieldValue, calculateShiftDuration, isScheduleLocked, handleUnassign, closeAllContextMenus, setContextMenuOpen }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: isScheduleLocked });
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: stationColor,
    opacity: isDragging ? 0.6 : 1,
    border: isDragging ? '2px dashed #888' : '1px solid #ddd',
  };

  const shiftDuration = calculateShiftDuration(daySchedule.time);

  // Handle right-click to show context menu
  const handleContextMenu = (e) => {
    if (isScheduleLocked || daySchedule.location === 'Unassigned') return;
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
    setContextMenuOpen(true); // Notify parent that a context menu is open
  };

  // Handle clicking the unassign option
  const handleUnassignClick = () => {
    handleUnassign(worker, day, daySchedule);
    setContextMenu({ visible: false, x: 0, y: 0 });
    setContextMenuOpen(false); // Notify parent that the context menu is closed
  };

  // Close context menu when triggered by parent or clicking on the menu
  const handleCloseContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0 });
    setContextMenuOpen(false); // Notify parent that the context menu is closed
  };

  // Listen for close signal from parent
  useEffect(() => {
    if (closeAllContextMenus) {
      setContextMenu({ visible: false, x: 0, y: 0 });
      setContextMenuOpen(false);
    }
  }, [closeAllContextMenus, setContextMenuOpen]);

  // Portal for context menu
  const contextMenuPortal = contextMenu.visible ? createPortal(
    <div
      className="context-menu"
      style={{
        position: 'fixed', // Use fixed to position relative to viewport
        top: contextMenu.y,
        left: contextMenu.x,
        zIndex: 10000, // High z-index to ensure it’s above everything
        background: '#fff',
        border: '1px solid #ccc',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        padding: '5px',
        borderRadius: '4px',
      }}
      onClick={handleCloseContextMenu}
    >
      <div
        className="context-menu-item"
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          ':hover': {
            background: '#f0f0f0',
          },
        }}
        onClick={handleUnassignClick}
      >
        Unassign
      </div>
    </div>,
    document.body // Render at the root of the DOM
  ) : null;

  return (
    <>
      <td
        ref={setNodeRef}
        style={style}
        {...(isScheduleLocked ? {} : { ...attributes, ...listeners })}
        className={daySchedule.location === 'Unassigned' ? 'unassigned' : 'scheduled'}
        onContextMenu={handleContextMenu}
      >
        <div>
          <input
            type="text"
            value={daySchedule.location !== 'Unassigned' ? daySchedule.location : ''}
            onFocus={() =>
              !isScheduleLocked &&
              setFocusedFieldValue({
                worker,
                day,
                field: 'location',
                value: daySchedule.location,
              })
            }
            onChange={(e) => !isScheduleLocked && handleChange(worker, day, 'location', e.target.value)}
            placeholder="Location"
            disabled={isScheduleLocked}
          />
          <input
            type="text"
            value={daySchedule.time}
            onFocus={() =>
              !isScheduleLocked &&
              setFocusedFieldValue({
                worker,
                day,
                field: 'time',
                value: daySchedule.time,
              })
            }
            onChange={(e) => !isScheduleLocked && handleChange(worker, day, 'time', e.target.value)}
            placeholder="Time"
            disabled={isScheduleLocked}
          />
          <span className="shift-duration">
            {daySchedule.time && shiftDuration !== '0.00' ? `${shiftDuration}` : '—'}
          </span>
        </div>
      </td>
      {contextMenuPortal}
    </>
  );
};


const Dashboard = () => {
  const [schedule, setSchedule] = useState({});
  const [stationColors, setStationColors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');  // New state for success message
  const [isNewScheduleGenerated, setIsNewScheduleGenerated] = useState(false);  // State for tracking new schedule
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [datesOfWeek, setDatesOfWeek] = useState({});
  const [showSearch, setShowSearch] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [weekEndingDate, setWeekEndingDate] = useState('');
  const [unassignedStations, setUnassignedStations] = useState([]);
  const workersData = JSON.parse(localStorage.getItem('uploadedWorkers')) || []; 
  const uniqueWorkers = [...new Set(workersData.map(worker => worker.name))];
  const [auditLogBuffer, setAuditLogBuffer] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [focusedFieldValue, setFocusedFieldValue] = useState(null);
  const [isScheduleLocked, setIsScheduleLocked] = useState(false);
  const [workers, setWorkers] = useState([]);
  const [contextMenuOpen, setContextMenuOpen] = useState(false); // Track if any context menu is open
  const [closeAllContextMenus, setCloseAllContextMenus] = useState(false); // Trigger to close all menus
  const [workerRoles, setWorkerRoles] = useState({}); // New state to store name-role pairs
    // State to track if an assign/unassign action requires saving
  const [needsSave, setNeedsSave] = useState(false);

  // useEffect to trigger handleSave after unassignedStations updates
  useEffect(() => {
    if (needsSave) {
      const saveAfterStateUpdate = async () => {
        try {
          await handleSave();
          setNeedsSave(false); // Reset after saving
        } catch (error) {
          console.error('Error in auto-save:', error);
          alert('Failed to auto-save schedule: ' + error.message);
        }
      };
      saveAfterStateUpdate();
    }
  }, [needsSave, unassignedStations]);


  useEffect(() => {
  const fetchWorkers = async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        console.error('Session error:', sessionError);
        return;
      }

      const userId = session.user.id;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        console.error('Profile error:', profileError);
        return;
      }

      const organizationId = profile.organization_id;
      const { data: workersData, error: workerError } = await supabase
        .from('workers')
        .select('name, role') // Fetch name and role
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true }); // Maintain created_at order

      if (workerError) {
        console.error('Error fetching workers:', workerError);
        return;
      }

      // Set workers as array of names (unchanged)
      setWorkers(workersData.map((worker) => worker.name));
      // Set workerRoles as object mapping names to roles
      setWorkerRoles(
        workersData.reduce((acc, worker) => {
          acc[worker.name] = worker.role?.toLowerCase() || ''; // Use empty string if role is null
          return acc;
        }, {})
      );
    } catch (error) {
      console.error('Error in fetchWorkers:', error);
    }
  };

  fetchWorkers();
}, []);

  // Define the order you want with lowercase keys for case-insensitive matching
const roleOrder = {
  dispatcher: 1,
  atp: 2,
  'ticket office': 3,
  cs: 4,
};

// Utility function to get a worker's role from schedule
const getWorkerRole = (worker) => {
  const days = schedule[worker];
  if (!days) return Infinity; // fallback
  // Get role from the first day and convert to lowercase for comparison
  const role = days[Object.keys(days)[0]]?.role || 'cs';
  return role.toLowerCase(); // Ensure case-insensitive comparison
};



// Sort workers: group by role and sort by role order, preserving workers array order within roles
const sortedWorkers = [
  // Include all workers from schedule, grouped by role and sorted by role order
  ...(() => {
    // Create initial order from workers array, filtered by schedule
    const initialOrder = workers.filter((worker) => schedule[worker]);
    
    // Group workers by role while preserving initial order
    const groupedByRole = {};
    initialOrder.forEach((worker) => {
      const role = getWorkerRole(worker);
      if (!groupedByRole[role]) {
        groupedByRole[role] = [];
      }
      groupedByRole[role].push(worker);
    });
    
    // Sort roles by roleOrder and flatten
    return Object.keys(groupedByRole)
      .sort((a, b) => {
        const roleOrderA = roleOrder[a] || 999;
        const roleOrderB = roleOrder[b] || 999;
        return roleOrderA - roleOrderB;
      })
      .flatMap((role) => groupedByRole[role]);
  })(),
];

  useEffect(() => {
    const saved = localStorage.getItem('workerSchedule');
    if (saved) {
      const parsed = JSON.parse(saved);
      setSchedule(parsed);
      assignStationColors(parsed);
  
      // Extract datesOfWeek from parsed schedule
      const newDatesOfWeek = {};
      Object.keys(parsed).forEach((worker) => {
        daysOfWeek.forEach((day) => {
          const entry = parsed[worker][day];
          if (entry?.date && !newDatesOfWeek[day]) {
            newDatesOfWeek[day] = entry.date;
          }
        });
      });
      setDatesOfWeek(newDatesOfWeek);
    } else {
      const allocatedSchedule = allocateWorkers();
      const formattedSchedule = formatSchedule(allocatedSchedule);
      setSchedule(formattedSchedule);
      assignStationColors(formattedSchedule);
    }
  }, []);
  
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

   // New useEffect for global click listener to close context menus
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Only close if a context menu is open and the click is not on a context menu
      if (contextMenuOpen && !event.target.closest('.context-menu')) {
        setCloseAllContextMenus(true);
        setContextMenuOpen(false);
        // Reset closeAllContextMenus after a short delay to allow SortableItem to react
        setTimeout(() => setCloseAllContextMenus(false), 0);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenuOpen]);

  const formatSchedule = async (allocatedSchedule) => {
  const formattedSchedule = {};

  // Step 1: Fetch user and organization details
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) {
    throw new Error("User not logged in");
  }

  const userId = session.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Error("Could not fetch user profile");
  }

  const organizationId = profile.organization_id;

  // Step 2: Fetch workers' availability data (including day columns)
  const { data: workersData, error: workerError } = await supabase
    .from('workers')
    .select('name, role, monday, tuesday, wednesday, thursday, friday, saturday, sunday')
    .eq('organization_id', organizationId);

  if (workerError) {
    throw new Error("Could not fetch workers: " + workerError.message);
  }

  // Step 3: Fetch unique dates from the stations table
  const { data: stations, error: stationsError } = await supabase
    .from('stations')
    .select('date')
    .eq('organization_id', organizationId);

  if (stationsError) {
    throw new Error("Could not fetch stations data");
  }

  // Map unique dates to days of the week
  const uniqueDates = [...new Set(stations.map(row => row.date))].sort((a, b) => new Date(a) - new Date(b));
  const newDatesOfWeek = {};
  daysOfWeek.forEach((day, index) => {
    const date = uniqueDates[index];
    if (date) {
      newDatesOfWeek[day] = date;
    }
  });
  setDatesOfWeek(newDatesOfWeek);

  // Step 4: Create a map of worker availability
  const workerAvailability = {};
  workersData.forEach((worker) => {
    workerAvailability[worker.name] = {
      monday: worker.monday?.toLowerCase(),
      tuesday: worker.tuesday?.toLowerCase(),
      wednesday: worker.wednesday?.toLowerCase(),
      thursday: worker.thursday?.toLowerCase(),
      friday: worker.friday?.toLowerCase(),
      saturday: worker.saturday?.toLowerCase(),
      sunday: worker.sunday?.toLowerCase(),
      role: worker.role?.toLowerCase() || '',
    };
  });

  // Step 5: Fill in assigned workers from allocatedSchedule
  allocatedSchedule.forEach((station) => {
    if (station.allocatedTo && station.allocatedTo !== 'Unassigned') {
      const worker = station.allocatedTo;
      const day = station.day.toLowerCase();
      const availability = workerAvailability[worker]?.[day];

      // Only assign if the worker is available (i.e., not N/A, AL, or Rest Day)
      if (availability && !['n/a', 'al', 'rest day'].includes(availability)) {
        if (!formattedSchedule[worker]) {
          formattedSchedule[worker] = {};
        }
        formattedSchedule[worker][station.day] = {
          location: station.location,
          time: station.time,
          date: station.date,
          role: station.role || workerAvailability[worker].role,
        };
      }
    }
  });

  // Step 6: Ensure all workers are included and fill unassigned days
  workersData.forEach((worker) => {
    const workerName = worker.name;
    if (!formattedSchedule[workerName]) {
      formattedSchedule[workerName] = {};
    }

    daysOfWeek.forEach((day) => {
      const dayLower = day.toLowerCase();
      const availability = workerAvailability[workerName]?.[dayLower] || 'n/a';

      // If the day is already assigned, skip to avoid overwriting
      if (formattedSchedule[workerName][day]) {
        return;
      }

      // Set time based on availability
      let timeValue = '';
      let locationValue = 'Unassigned';
      if (['n/a', 'al', 'rest day'].includes(availability)) {
        timeValue = availability.toUpperCase(); // Use N/A, AL, or Rest Day
      }

      formattedSchedule[workerName][day] = {
        location: locationValue,
        time: timeValue,
        date: newDatesOfWeek[day] || '',
        role: workerAvailability[workerName].role,
      };
    });
  });

  return formattedSchedule;
};
  
  const predefinedStationColors = {
  "KINGS CROSS": "#9933FF",
  "KENTISH TOWN": "#7030A0",
  "FINSBURY PARK": "#5DC937",
  "HATFILED (HERTS)": "#0070C0",
  "ST NEOTS": "#156082",
  "HITCHIN": "#FF0000",
  "HARRINGAY": "#FFC000",
  "FARRINGDON": "#0C769E",
  "FARRINGDON CS": "#0C769E",
  "BEDFORD": "#A6A6A6",
  "BLACKFRIARS": "#FFCCFF",
  "STEVENAGE": "#4D93D9",
  "ST ALBANS CITY": "#14F9F4",
  "LUTON": "#FFFF00",
  "CITY THAMESLINK": "#FFCC00",
  "GORDON HILL": "#CCCCFF",
  "WEST HAMPSTEAD": "#FF0000",
  "ELEPHANT AND CASTLE": "#FF99CC",
  "HERTFORD NORTH ATP": "#C0E6F5",
  "MARGATE": "#FF6D01",
  "SITTINGBOURNE": "#92D050",
  "RAMSGATE": "#46BDC6",
  "DOVER PRIORY": "#FFD966",
  "SITTINGBOURNE": "#92D050",
  "RAMSGATE": "#46BDC6",
  "DOVER PRIORY": "#FFD966",
  "HUNTINGDON": "#215C98",
  "BIGGLESWADE": "#FBE2D5",
  "LETCHWORTH": "#00A249",
  "ROYSTON": "#A5E9AF",
  "KINGS LYNN": "#BFBFBF",
  "HERTFORD NORTH": "#C0E6F5",
  "WELWYN GARDEN CITY": "#A6C9EC",
  "HATFIELD": "#0070C0",
  "ALEXANDRA PALACE": "#C00000",
  "NEW BARNET": "#FF9966",
  "POTTERS BAR": "#CC0000",
  "HORNSEY": "#BFBFBF",
  "DRAYTON PARK": "#A5E9AF",
  "ST PANCRAS": "#44B3E1",
  "LUTON AIRPORT PARKWAY": "#FFFF99",
  "HARPENDEN": "#F7C7AC",
  "ELSTREE & BOREHAMWOOD": "#E97132",
  "DENMARK HILL": "#44B3E1",
   
  
  
  // Add more as needed
};

  const assignStationColors = (formattedSchedule) => {
  const uniqueStations = new Set();

  Object.keys(formattedSchedule).forEach((worker) => {
    daysOfWeek.forEach((day) => {
      const station = formattedSchedule[worker][day].location;
      if (station && station !== 'Unassigned') {
        uniqueStations.add(station);
      }
    });
  });

  const newStationColors = {};

  uniqueStations.forEach((station) => {
  const upperCaseStation = station.toUpperCase();
  if (predefinedStationColors[upperCaseStation]) {
    newStationColors[station] = predefinedStationColors[upperCaseStation];
  } else {
    // Optional fallback
    newStationColors[station] = "#cccccc";
  }
});


  setStationColors(newStationColors);
};

  const generateUniqueColors = (numColors) => {
    const colors = [];
    const baseColors = [
      '#f44336', '#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4', 
      '#8bc34a', '#ff5722', '#3f51b5', '#673ab7', '#ffeb3b', '#cddc39'
    ];

    for (let i = 0; i < numColors; i++) {
      colors.push(baseColors[i % baseColors.length]);
    }

    return colors;
  };

  const calculateShiftDuration = (timeRange) => {
  if (!timeRange || !timeRange.includes('-')) return '0.00';

  const [start, end] = timeRange.split('-');
  if (!start || !end) return '0.00';

  const startHour = parseInt(start.slice(0, 2), 10);
  const startMin = parseInt(start.slice(2), 10);
  const endHour = parseInt(end.slice(0, 2), 10);
  const endMin = parseInt(end.slice(2), 10);

  let startDate = new Date(0, 0, 0, startHour, startMin);
  let endDate = new Date(0, 0, 0, endHour, endMin);

  if (endDate <= startDate) {
    endDate = new Date(0, 0, 1, endHour, endMin); // Handle midnight crossing
  }

  const diff = (endDate - startDate) / (1000 * 60 * 60);
  return isNaN(diff) ? '0.00' : diff.toFixed(2);
};

  const calculateHoursWorked = (workerSchedule) => {
  let totalHours = 0;
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  daysOfWeek.forEach((day) => {
    const entry = workerSchedule[day];
    const timeRange = entry?.time;

    if (timeRange && timeRange.includes('-')) {
      const [start, end] = timeRange.split('-');

      if (start && end) {
        const startHour = parseInt(start.slice(0, 2), 10);
        const startMin = parseInt(start.slice(2), 10);
        const endHour = parseInt(end.slice(0, 2), 10);
        const endMin = parseInt(end.slice(2), 10);

        let startDate = new Date(0, 0, 0, startHour, startMin);
        let endDate = new Date(0, 0, 0, endHour, endMin);

        // If end time is earlier than start time, assume it crosses midnight
        if (endDate <= startDate) {
          endDate = new Date(0, 0, 1, endHour, endMin); // Add one day to endDate
        }

        const diff = (endDate - startDate) / (1000 * 60 * 60);

        if (!isNaN(diff)) {
          totalHours += diff;
        }
      }
    }
  });

  return totalHours.toFixed(2);
};
// Blend hex color with white by given opacity (0-1)

const blendWithWhite = (hex, opacity) => {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const rBlended = Math.round(r + (255 - r) * opacity);
  const gBlended = Math.round(g + (255 - g) * opacity);
  const bBlended = Math.round(b + (255 - b) * opacity);

  const toHex = (n) => n.toString(16).padStart(2, '0');

  return 'FF' + toHex(rBlended) + toHex(gBlended) + toHex(bBlended);
};

const normalizeToARGB = (colorInput) => {
  if (!colorInput) return 'FFF1F1F1';
  let s = String(colorInput).trim();

  const rgbMatch = s.match(/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = Number(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = Number(rgbMatch[3]).toString(16).padStart(2, '0');
    return ('FF' + r + g + b).toUpperCase();
  }

  if (s.startsWith('#')) s = s.slice(1);
  s = s.toUpperCase();

  if (s.length === 3) {
    s = s.split('').map((c) => c + c).join('');
  }

  if (s.length === 6) return 'FF' + s;
  if (s.length === 8) return s;

  return 'FFF1F1F1';
};

  const handleUnassign = async (worker, day, daySchedule) => {
    if (isScheduleLocked) {
      alert('Schedule is locked and cannot be modified.');
      return;
    }
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        throw new Error('User not logged in');
      }
      const userId = session.user.id;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id, user_name')
        .eq('id', userId)
        .single();
      if (profileError || !profile) {
        throw new Error('Could not fetch user profile');
      }
      const organizationId = profile.organization_id;
      const userName = profile.user_name;
      setUnassignedStations((prev) => [
        ...prev,
        {
          day,
          location: daySchedule.location,
          time: daySchedule.time,
          date: daySchedule.date || '',
          role: daySchedule.role,
          assignedWorker: '',
        },
      ]);
      setSchedule((prevSchedule) => {
        const updatedSchedule = { ...prevSchedule };
        updatedSchedule[worker][day] = {
          location: 'Unassigned',
          time: '',
          date: daySchedule.date || '',
          role: daySchedule.role, // Preserve role
        };
        return updatedSchedule;
      });
      setAuditLogBuffer((prevLog) => [
        ...prevLog,
        {
          worker_name: worker,
          day_of_week: day,
          field: 'location',
          old_value: daySchedule.location,
          new_value: 'Unassigned',
        },
        {
          worker_name: worker,
          day_of_week: day,
          field: 'time',
          old_value: daySchedule.time,
          new_value: '',
        },
      ]);
      //await handleSave();
      // Trigger save after state updates
      setNeedsSave(true);
    } catch (error) {
      console.error('Error unassigning shift:', error);
      alert('Failed to unassign shift: ' + error.message);
    }
  };

  const exportToExcel = async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Schedule');

  /** -----------------------
 *  HEADER BLOCK / TITLE
 * ----------------------- */
// Merge across full table width (daysOfWeek + 2 extra cols)
const totalCols = daysOfWeek.length + 2;

// Row 1: Title
worksheet.mergeCells(1, 1, 1, totalCols);
const titleCell = worksheet.getCell(1, 1);
titleCell.value = 'Temporary Worker Timesheet & Roster';
titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
titleCell.font = { bold: true, size: 16, name: 'Arial', color: { argb: 'FF000000' } };
titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
titleCell.border = {
  top: { style: 'thin', color: { argb: 'FF212121' } },
  left: { style: 'thin', color: { argb: 'FF212121' } },
  bottom: { style: 'thin', color: { argb: 'FF212121' } },
  right: { style: 'thin', color: { argb: 'FF212121' } },
};

// Row 2: Empty spacer row (merged + filled, no borders)
worksheet.addRow([]);
worksheet.mergeCells(2, 1, 2, totalCols);
const spacerCell = worksheet.getCell(2, 1);
spacerCell.value = '';
spacerCell.fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD3D3D3' },
};
spacerCell.alignment = { vertical: 'middle', horizontal: 'center' };
worksheet.getRow(2).height = 20;

// Row 3: "Our Reference:" (left) | "Client:" (right)
worksheet.mergeCells(3, 1, 3, Math.floor(totalCols / 2));
worksheet.mergeCells(3, Math.floor(totalCols / 2) + 1, 3, totalCols);
worksheet.getCell(3, 1).value = 'Our Reference:';
worksheet.getCell(3, Math.floor(totalCols / 2) + 1).value = 'Client:';

// Row 4: "Job Title:" (left) | "Purchase Order:" (right)
worksheet.mergeCells(4, 1, 4, Math.floor(totalCols / 2));
worksheet.mergeCells(4, Math.floor(totalCols / 2) + 1, 4, totalCols);
worksheet.getCell(4, 1).value = 'Job Title:';
worksheet.getCell(4, Math.floor(totalCols / 2) + 1).value = 'Purchase Order:';

// Row 5: empty left | "Week Ending Date:" (right)
worksheet.mergeCells(5, 1, 5, Math.floor(totalCols / 2));
worksheet.mergeCells(5, Math.floor(totalCols / 2) + 1, 5, totalCols);
worksheet.getCell(5, Math.floor(totalCols / 2) + 1).value = 'Week Ending Date:';

// Style for rows 3–5
for (let r = 3; r <= 5; r++) {
  const row = worksheet.getRow(r);
  row.height = 20;
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    };
    cell.font = { bold: false, size: 12, name: 'Arial', color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF212121' } },
      left: { style: 'thin', color: { argb: 'FF212121' } },
      bottom: { style: 'thin', color: { argb: 'FF212121' } },
      right: { style: 'thin', color: { argb: 'FF212121' } },
    };
  });
}


  /** -----------------------
   *  SCHEDULE TABLE HEADERS
   * ----------------------- */
  const headers = ['Day', ...daysOfWeek, '72h Limit'];
  const datesRow = ['Date', ...daysOfWeek.map((day) => datesOfWeek[day] || '—'), 'Total Hours'];

  worksheet.addRow([]);
  worksheet.addRow(headers);
  worksheet.addRow(datesRow);

  // Adjust header styling (rows 6 and 7 now, since 1–4 are the block and 5 is empty)
  const headerStartRow = worksheet.lastRow.number - 1;
  [headerStartRow, headerStartRow + 1].forEach((rowNum) => {
    const row = worksheet.getRow(rowNum);
    row.font = { bold: true, size: 12, name: 'Arial', color: { argb: 'FF212121' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF212121' } },
        left: { style: 'thin', color: { argb: 'FF212121' } },
        bottom: { style: 'thin', color: { argb: 'FF212121' } },
        right: { style: 'thin', color: { argb: 'FF212121' } },
      };
    });
  });

  /** -----------------------
   *  WORKER ROWS
   * ----------------------- */
  sortedWorkers.forEach((worker) => {
    const startRow = worksheet.lastRow.number + 1;

    // Time row
    const timeRow = [worker];
    daysOfWeek.forEach((day) => {
      const { time } = schedule[worker][day] || {};
      timeRow.push(time || '—');
    });
    timeRow.push('');
    worksheet.addRow(timeRow);

    // Location row
    const locationRowValues = [''];
    daysOfWeek.forEach((day) => {
      const loc = (schedule[worker][day] && schedule[worker][day].location) || '—';
      locationRowValues.push(loc);
    });
    locationRowValues.push(''); // No "72h limit" repeat here
    const locRowRef = worksheet.addRow(locationRowValues);

    daysOfWeek.forEach((day, idx) => {
      const colIndex = idx + 2;
      const cell = locRowRef.getCell(colIndex);
      const locVal = locationRowValues[colIndex - 1] ?? '';

      let baseColor = '#f1f1f1';
      try {
        if (typeof getStationColor === 'function') baseColor = getStationColor(locVal) || baseColor;
      } catch {
        baseColor = '#f1f1f1';
      }

      const argb = normalizeToARGB(baseColor); // Returns ARGB with full opacity


      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    });

    // Hours row
    const hoursRow = ['Hours Worked'];
    daysOfWeek.forEach((day) => {
      const time = schedule[worker][day] && schedule[worker][day].time;
      const duration = calculateShiftDuration(time);
      hoursRow.push(time && duration !== '0.00' ? `${duration}` : '—');
    });
    hoursRow.push(calculateHoursWorked(schedule[worker]));
    worksheet.addRow(hoursRow);
    // Set custom row heights for worker block
worksheet.getRow(startRow).height = 70;       // Time row
worksheet.getRow(startRow + 1).height = 50;   // Location row
worksheet.getRow(startRow + 2).height = 30;   // Hours row


    // Merge worker name cells
    worksheet.mergeCells(`A${startRow}:A${startRow + 1}`);

    // Style worker block
    const nameCell = worksheet.getCell(`A${startRow}`);
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
    nameCell.font = { bold: true, name: 'Arial', size: 11, color: { argb: 'FF212121' } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    nameCell.border = {
      top: { style: 'thin', color: { argb: 'FF212121' } },
      left: { style: 'thin', color: { argb: 'FF212121' } },
      bottom: { style: 'thin', color: { argb: 'FF212121' } },
      right: { style: 'thin', color: { argb: 'FF212121' } },
    };

    for (let r = startRow; r <= startRow + 2; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell, colNum) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF212121' } },
          left: { style: 'thin', color: { argb: 'FF212121' } },
          bottom: { style: 'thin', color: { argb: 'FF212121' } },
          right: { style: 'thin', color: { argb: 'FF212121' } },
        };
        cell.font = { name: 'Arial', size: 11, color: { argb: 'FF212121' }, bold: colNum === 1 || r === startRow + 1 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
    }

    // Separator row
    const separatorRow = worksheet.addRow(new Array(daysOfWeek.length + 2).fill(''));
    separatorRow.height = 8;
    separatorRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F4F4F' } };
    });
  });

  worksheet.columns = [{ width: 25 }, ...daysOfWeek.map(() => ({ width: 20 })), { width: 15 }];

  // Save
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, 'worker_schedule.xlsx');
};

  const downloadDashboardAsPDF = async () => {
  const pdf = new jsPDF('portrait', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const tableWidth = pageWidth - 2 * margin;
  const colCount = daysOfWeek.length + 2; // Worker + 7 days + Hours Worked
  const colWidth = tableWidth / colCount;
  const rowHeight = 8; // Standard row height in mm
  const headerRowHeight = 10;
  const workerRowHeight = 18; // Adjusted for time/location/hours rows
  const separatorRowHeight = 2;
  let yPosition = margin;

  // Helper function to convert hex to RGB
  const hexToRgb = (hex) => {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return { r, g, b };
  };

  // Helper function to normalize ARGB
  const normalizeToARGB = (colorInput) => {
    if (!colorInput) return 'FFF1F1F1';
    let s = String(colorInput).trim();
    if (s.startsWith('#')) s = s.slice(1);
    s = s.toUpperCase();
    if (s.length === 3) s = s.split('').map(c => c + c).join('');
    if (s.length === 6) return 'FF' + s;
    if (s.length === 8) return s;
    return 'FFF1F1F1';
  };

  // Set font
  pdf.setFont('Arial');

  // *** Header Block ***
  // Row 1: Title
  pdf.setFontSize(16);
  pdf.setFont('Arial', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.setFillColor(211, 211, 211); // FFD3D3D3
  pdf.rect(margin, yPosition, tableWidth, headerRowHeight, 'F');
  pdf.text('Temporary Worker Timesheet & Roster', pageWidth / 2, yPosition + 7, { align: 'center' });
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(33, 33, 33); // FF212121
  pdf.rect(margin, yPosition, tableWidth, headerRowHeight);
  yPosition += headerRowHeight;

  // Row 2: Spacer
  yPosition += 5; // Adjusted for 20px height (~5mm)
  pdf.setFillColor(211, 211, 211);
  pdf.rect(margin, yPosition, tableWidth, 5, 'F');
  yPosition += 5;

  // Rows 3-5: Reference, Job Title, Week Ending
  const headerFields = [
    { left: 'Our Reference:', right: 'Client:' },
    { left: 'Job Title:', right: 'Purchase Order:' },
    { left: '', right: 'Week Ending Date: ' + (datesOfWeek['Saturday'] || '—') },
  ];
  pdf.setFontSize(12);
  pdf.setFont('Arial', 'normal');
  headerFields.forEach(({ left, right }) => {
    pdf.setFillColor(211, 211, 211);
    pdf.rect(margin, yPosition, tableWidth / 2, rowHeight, 'F');
    pdf.rect(margin + tableWidth / 2, yPosition, tableWidth / 2, rowHeight, 'F');
    pdf.setTextColor(0, 0, 0);
    pdf.text(left, margin + 2, yPosition + 6);
    pdf.text(right, margin + tableWidth / 2 + 2, yPosition + 6);
    pdf.rect(margin, yPosition, tableWidth / 2, rowHeight);
    pdf.rect(margin + tableWidth / 2, yPosition, tableWidth / 2, rowHeight);
    yPosition += rowHeight;
  });

  // Spacer row
  yPosition += 2;

  // *** Schedule Table Headers ***
  const headers = ['Day', ...daysOfWeek, '72h Limit'];
  const datesRow = ['Date', ...daysOfWeek.map(day => datesOfWeek[day] || '—'), 'Total Hours'];
  [headers, datesRow].forEach(rowData => {
    pdf.setFontSize(12);
    pdf.setFont('Arial', 'bold');
    pdf.setTextColor(33, 33, 33);
    rowData.forEach((cell, idx) => {
      const x = margin + idx * colWidth;
      pdf.text(cell, x + colWidth / 2, yPosition + 6, { align: 'center' });
      pdf.rect(x, yPosition, colWidth, rowHeight);
    });
    yPosition += rowHeight;
  });

  // *** Worker Rows ***
  Object.keys(schedule).forEach((worker, workerIdx) => {
    if (yPosition > pageHeight - margin - 3 * workerRowHeight - separatorRowHeight) {
      pdf.addPage();
      yPosition = margin;
    }

    const startRowY = yPosition;

    // Time row
    const timeRow = [worker];
    daysOfWeek.forEach(day => {
      const { time } = schedule[worker][day] || {};
      timeRow.push(time || '—');
    });
    timeRow.push('');
    timeRow.forEach((cell, idx) => {
      const x = margin + idx * colWidth;
      pdf.setFontSize(11);
      pdf.setFont('Arial', idx === 0 ? 'bold' : 'normal');
      pdf.setTextColor(33, 33, 33);
      if (idx === 0) {
        pdf.setFillColor(211, 211, 211);
        pdf.rect(x, yPosition, colWidth, workerRowHeight * 2, 'F'); // Merged cell
        pdf.text(cell, x + colWidth / 2, yPosition + workerRowHeight, { align: 'center', maxWidth: colWidth - 2 }); // Center vertically in merged cell
      } else {
        pdf.rect(x, yPosition, colWidth, workerRowHeight);
        pdf.text(cell, x + colWidth / 2, yPosition + 8, { align: 'center', maxWidth: colWidth - 2 });
      }
    });
    yPosition += workerRowHeight;

    // Location row
    const locationRow = [''];
    daysOfWeek.forEach(day => {
      const loc = (schedule[worker][day] && schedule[worker][day].location) || '—';
      locationRow.push(loc);
    });
    locationRow.push('');
    locationRow.forEach((cell, idx) => {
      const x = margin + idx * colWidth;
      pdf.setFontSize(8);
      pdf.setFont('Arial', 'bold');
      pdf.setTextColor(33, 33, 33);
      if (idx > 0 && idx <= daysOfWeek.length) {
        const locVal = locationRow[idx] || '—';
        const baseColor = getStationColor(locVal) || '#f1f1f1';
        const argb = normalizeToARGB(baseColor);
        const { r, g, b } = hexToRgb(argb.slice(2));
        pdf.setFillColor(r, g, b);
        pdf.rect(x, yPosition, colWidth, workerRowHeight, 'F');
      }
      pdf.text(cell, x + colWidth / 2, yPosition + 8, { align: 'center', maxWidth: colWidth - 2 });
      if (idx !== 0) {
        pdf.rect(x, yPosition, colWidth, workerRowHeight);
      }
    });
    yPosition += workerRowHeight;

    // Hours row
    const hoursRow = ['Hours Worked'];
    daysOfWeek.forEach(day => {
      const time = schedule[worker][day] && schedule[worker][day].time;
      const duration = calculateShiftDuration(time);
      hoursRow.push(time && duration !== '0.00' ? `${duration}` : '—');
    });
    hoursRow.push(calculateHoursWorked(schedule[worker]));
    hoursRow.forEach((cell, idx) => {
      const x = margin + idx * colWidth;
      pdf.setFontSize(11);
      pdf.setFont('Arial', idx === 0 ? 'bold' : 'normal');
      pdf.setTextColor(33, 33, 33);
      pdf.text(cell, x + colWidth / 2, yPosition + 8, { align: 'center', maxWidth: colWidth - 2 });
      pdf.rect(x, yPosition, colWidth, workerRowHeight);
    });
    yPosition += workerRowHeight;

    // Merge worker name cell
    pdf.rect(margin, startRowY, colWidth, workerRowHeight * 2);

    // Separator row
    pdf.setFillColor(79, 79, 79); // FF4F4F4F
    pdf.rect(margin, yPosition, tableWidth, separatorRowHeight, 'F');
    yPosition += separatorRowHeight;
  });

  pdf.save('worker_schedule.pdf');
};
  
  const handleUnassignedChange = (index, field, value) => {
    setUnassignedStations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };
  
      const assignUnassignedStation = async (index) => {
  if (isScheduleLocked) {
    alert('Schedule is locked and cannot be modified.');
    return;
  }

  const station = unassignedStations[index];
  const worker = station.assignedWorker?.trim();

  if (!worker) {
    alert('Please enter a valid worker name.');
    return;
  }

  try {
    // Check if the worker exists
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      throw new Error('User not logged in');
    }

    const userId = session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, user_name')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Could not fetch user profile');
    }

    const organizationId = profile.organization_id;
    const userName = profile.user_name;

    // Fetch worker names from database for the org
    const { data: workersData, error: workerError } = await supabase
      .from('workers')
      .select('name')
      .eq('organization_id', organizationId);

    if (workerError || !workersData) {
      throw new Error('Error fetching workers from database');
    }

    // Validate worker existence (case-insensitive)
    const workerExists = workersData.some(
      (w) => w.name.toLowerCase() === worker.toLowerCase()
    );

    if (!workerExists) {
      alert(`Warning: Worker "${worker}" does not exist. Please enter a valid worker name.`);
      return;
    }

    // Define non-working statuses
    const nonWorkingStatuses = ['AL', 'N/A', 'REST DAY'];

    // Check if worker already has a shift or non-working status on this day
    const currentDayAssignment = schedule[worker]?.[station.day];
    if (currentDayAssignment) {
      if (nonWorkingStatuses.includes(currentDayAssignment.time)) {
        alert(
          `Cannot assign shift to ${worker} on ${station.day}: Worker is marked as ${currentDayAssignment.time}.`
        );
        return;
      }
      if (currentDayAssignment.location !== 'Unassigned') {
        alert(
          `Warning: Worker "${worker}" already has a shift assigned on ${station.day} at ${currentDayAssignment.location} (${currentDayAssignment.time}).`
        );
        return;
      }
    }

    // Function to check 12-hour rest period for a worker on a specific day
    const checkRestPeriod = (worker, day, newTime, schedule) => {
      const daysIndex = daysOfWeek.indexOf(day);
      const prevDay = daysIndex > 0 ? daysOfWeek[daysIndex - 1] : null;
      const nextDay = daysIndex < daysOfWeek.length - 1 ? daysOfWeek[daysIndex + 1] : null;
      let hasEnoughRest = true;

      // Skip if newTime is empty or non-working
      if (!newTime || !newTime.includes('-') || nonWorkingStatuses.includes(newTime)) {
        return true; // No shift assigned or non-working day, so rest period check passes
      }

      const currentStartInMinutes = getShiftStartInMinutes(newTime);
      const currentEndInMinutes = getShiftEndInMinutes(newTime);

      // Check rest period from previous day's shift
      if (prevDay && schedule[worker]?.[prevDay]?.time) {
        const prevTime = schedule[worker][prevDay].time;
        // Skip if previous day is non-working
        if (!nonWorkingStatuses.includes(prevTime)) {
          const prevStart = getShiftStartInMinutes(prevTime);
          const prevEnd = getShiftEndInMinutes(prevTime);
          const isPrevOvernight = prevEnd <= prevStart;
          let restMinutes;
          if (!isPrevOvernight) {
            // Non-overnight: (prev end to midnight) + (midnight to current start)
            restMinutes = (1440 - prevEnd) + currentStartInMinutes;
          } else {
            // Overnight: current start - prev end (both from midnight)
            restMinutes = currentStartInMinutes - prevEnd;
          }
          if (restMinutes < 720) {
            hasEnoughRest = false;
          }
        }
      }

      // Check rest period to next day's shift
      if (hasEnoughRest && nextDay && schedule[worker]?.[nextDay]?.time) {
        const nextTime = schedule[worker][nextDay].time;
        // Skip if next day is non-working
        if (!nonWorkingStatuses.includes(nextTime)) {
          const nextStart = getShiftStartInMinutes(nextTime);
          const isCurrentOvernight = currentEndInMinutes <= currentStartInMinutes;
          let restMinutes;
          if (!isCurrentOvernight) {
            // Non-overnight: (current end to midnight) + (midnight to next start)
            restMinutes = (1440 - currentEndInMinutes) + nextStart;
          } else {
            // Overnight: next start - current end (both from midnight)
            restMinutes = nextStart - currentEndInMinutes;
          }
          if (restMinutes < 720) {
            hasEnoughRest = false;
          }
        }
      }

      return hasEnoughRest;
    };

    // Check rest period for the worker on the target day
    const isRestPeriodValid = checkRestPeriod(worker, station.day, station.time, schedule);

    if (!isRestPeriodValid) {
      alert(
        `Cannot assign shift to ${worker} on ${station.day}: It would violate the 12-hour rest period rule.`
      );
      return;
    }

    // Capture current values before update
    const oldAssignment = schedule[worker]?.[station.day] || {};
    const oldLocation = oldAssignment.location || null;
    const oldTime = oldAssignment.time || null;

    // Proceed with assignment
    setSchedule((prevSchedule) => {
      const updatedSchedule = { ...prevSchedule };

      if (!updatedSchedule[worker]) {
        updatedSchedule[worker] = {};
      }

      updatedSchedule[worker][station.day] = {
        location: station.location,
        time: station.time,
        date: station.date || '',
        role: station.role || workerRoles[worker] || '',
      };

      return updatedSchedule;
    });

    setUnassignedStations((prev) => prev.filter((_, i) => i !== index));

    // Use audit buffer instead of direct insert
    setAuditLogBuffer((prevLog) => [
      ...prevLog,
      {
        worker_name: worker,
        day_of_week: station.day,
        field: 'location',
        old_value: oldLocation,
        new_value: station.location,
      },
      {
        worker_name: worker,
        day_of_week: station.day,
        field: 'time',
        old_value: oldTime,
        new_value: station.time,
      },
    ]);

    // Trigger auto-save
    setNeedsSave(true);
  } catch (error) {
    console.error('Error assigning unassigned shift:', error);
    alert('Failed to assign shift: ' + error.message);
  }
};
  
    // Delete an unassigned shift
  const handleDeleteUnassigned = async (index) => {
    if (isScheduleLocked) {
      alert('Schedule is locked and cannot be modified.');
      return;
    }

    const station = unassignedStations[index];

    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to delete this unassigned shift?\n\nLocation: ${station.location}\nTime: ${station.time}\nDay: ${station.day}`
    );
    if (!confirmed) return;

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        throw new Error("User not logged in");
      }

      const userId = session.user.id;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id, user_name')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        throw new Error("Could not fetch user profile");
      }

      const organizationId = profile.organization_id;
      const userName = profile.user_name;

      // Remove from state
      setUnassignedStations((prev) => prev.filter((_, i) => i !== index));

      // Add audit log entry
      setAuditLogBuffer((prevLog) => [
        ...prevLog,
        {
          worker_name: null,
          day_of_week: station.day,
          field: 'unassigned_shift',
          old_value: `${station.location} - ${station.time}`,
          new_value: 'Deleted',
        },
      ]);

      // Trigger auto-save (will delete from DB in handleSave)
      setNeedsSave(true);

      // Optional: Show success
      setSuccessMessage('Unassigned shift deleted.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error deleting unassigned shift:', error);
      alert('Failed to delete unassigned shift: ' + error.message);
    }
  };
  

  const handleChange = (worker, day, field, newValue) => {
    if (isScheduleLocked) {
    alert('Schedule is locked and cannot be modified.');
    return;
  }
    const prevValue = schedule[worker][day][field];
  
    // Ignore if no real change
    if (prevValue === newValue) return;
  
    // Use the value from onFocus as the true "original" value
    const originalValue =
      focusedFieldValue &&
      focusedFieldValue.worker === worker &&
      focusedFieldValue.day === day &&
      focusedFieldValue.field === field
        ? focusedFieldValue.value
        : prevValue;
  
    setAuditLogBuffer((prevLog) => {
      const existingIndex = prevLog.findIndex(
        (entry) =>
          entry.worker_name === worker &&
          entry.day_of_week === day &&
          entry.field === field
      );
  
      const updatedEntry = {
        worker_name: worker,
        day_of_week: day,
        field,
        old_value: originalValue,
        new_value: newValue,
      };
  
      if (existingIndex !== -1) {
        const newLog = [...prevLog];
        newLog[existingIndex] = updatedEntry;
        return newLog;
      }
  
      return [...prevLog, updatedEntry];
    });
  
    // Apply the change
    setSchedule((prevSchedule) => {
      const updated = { ...prevSchedule };
      updated[worker][day][field] = newValue;
      return updated;
    });
  };
  
  

  const handleSave = async () => {
  try {
    const weekEndingDate = datesOfWeek['Saturday'];
    if (!weekEndingDate) {
      alert('Week ending date is missing');
      return;
    }
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      alert('User not logged in');
      return;
    }

    const userId = session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, user_name')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      alert('Could not fetch user profile');
      return;
    }

    const organizationId = profile.organization_id;
    const userName = profile.user_name;

    // Step 1: Check if any schedule entries exist for the given weekEndingDate
    const { data: existingSchedule, error: fetchError } = await supabase
      .from('schedule_entries')
      .select('*')
      .eq('week_ending', weekEndingDate);

    if (fetchError) {
      console.error('Error fetching schedule entries:', fetchError);
      alert('Failed to fetch schedule entries');
      return;
    }

    // Step 2: If no records exist, insert an audit log with "Schedule Created"
    if (existingSchedule.length === 0) {
      const { error: auditError } = await supabase
        .from('schedule_audit')
        .insert([{
          organization_id: organizationId,
          worker_name: null,
          day_of_week: null,
          old_location: null,
          old_time: null,
          new_location: null,
          new_time: null,
          changed_by: userName,
          week_ending: weekEndingDate,
          comments: 'Schedule Created',
        }]);

      if (auditError) {
        console.error('Error inserting audit log:', auditError);
        alert('Failed to insert audit log');
        return;
      }
    }

    // Step 3: Delete all existing unassigned shifts for the week
    const { error: deleteUnassignedError } = await supabase
      .from('unassigned_shifts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEndingDate);

    if (deleteUnassignedError) {
      console.error('Error deleting unassigned shifts:', deleteUnassignedError);
      alert('Failed to delete unassigned shifts');
      return;
    }

    // Step 4: Insert current unassignedStations into unassigned_shifts table
    if (unassignedStations.length > 0) {
      const unassignedShifts = unassignedStations.map((station) => ({
        organization_id: organizationId,
        day_of_week: station.day,
        location: station.location,
        time: station.time,
        date: station.date || datesOfWeek[station.day] || null,
        role: station.role || '',
        week_ending: weekEndingDate,
      }));

      const { error: insertUnassignedError } = await supabase
        .from('unassigned_shifts')
        .insert(unassignedShifts);

      if (insertUnassignedError) {
        console.error('Error inserting unassigned shifts:', insertUnassignedError);
        alert('Failed to insert unassigned shifts');
        return;
      }
    }

    // Step 5: Save the schedule
    await upsertSchedule(schedule, weekEndingDate);
    await saveAuditLog(weekEndingDate);

    setSuccessMessage('Schedule saved successfully!');
    setAuditLogBuffer([]); // Clear the buffer
    setTimeout(() => setSuccessMessage(''), 3000);
  } catch (err) {
    console.error('Error saving schedule:', err);
    alert('Failed to save schedule: ' + err.message);
  }
};
  const saveAuditLog = async (weekEndingDate) => {
    if (auditLogBuffer.length === 0) return;
  
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) return;
  
    const userId = session.user.id;
  
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, user_name')
      .eq('id', userId)
      .single();
  
    if (profileError || !profile) return;
  
    const organizationId = profile.organization_id;
    const userName = profile.user_name;
  
    const changesToInsert = auditLogBuffer.map((entry) => {
      const isLocation = entry.field === 'location';
      return {
        organization_id: organizationId,
        worker_name: entry.worker_name,
        day_of_week: entry.day_of_week,
        old_location: isLocation ? entry.old_value : null,
        new_location: isLocation ? entry.new_value : null,
        old_time: !isLocation ? entry.old_value : null,
        new_time: !isLocation ? entry.new_value : null,
        changed_by: userName,
        week_ending: weekEndingDate,
      };
    });
  
    const { error: insertError } = await supabase
      .from('schedule_audit')
      .insert(changesToInsert);
  
    if (insertError) {
      console.error('Audit log insert failed:', insertError.message);
    }
  };
    
  const fetchAuditTrail = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) return;
  
    const userId = session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();
  
    if (profileError || !profile) return;
  
    const organizationId = profile.organization_id;
    const weekEnding = datesOfWeek['Saturday'];
  
    const { data, error: fetchError } = await supabase
      .from('schedule_audit')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEnding)
      .order('changed_at', { ascending: false });
  
    if (!fetchError) {
      setAuditEntries(data);
      setShowAuditModal(true);
    }
  };
  

  const getStationColor = (stationName) => {
    return stationColors[stationName] || '#f1f1f1';
  };

  // New function to generate a new schedule on button click
  const generateNewSchedule = async () => {
    const allocatedSchedule = await allocateWorkers();
    console.log(allocatedSchedule);
    const formattedSchedule = await formatSchedule(allocatedSchedule);
    setSchedule(formattedSchedule); // Set new schedule
    console.log(schedule);
    assignStationColors(formattedSchedule); // Assign new station colors
    setIsNewScheduleGenerated(true); // Track that a new schedule has been generated

// NEW: Filter unassigned stations and set them
const unassigned = allocatedSchedule.filter(
  (station) => station.allocatedTo === 'Unassigned'
);
setUnassignedStations(unassigned);
  };


  const upsertSchedule = async (schedule, weekEndingDate) => {
  
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  
    if (sessionError || !session?.user) {
      throw new Error("User not logged in");
    }
  
    const userId = session.user.id;
  
    // Get organization_id from user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();
  
  
    if (profileError || !profile) {
      throw new Error("Could not fetch user profile or organization");
    }
  
    const organizationId = profile.organization_id;
    // Check if any row for this week_ending is locked
  const { data: lockedRows, error: fetchError } = await supabase
    .from('schedule_entries')
    .select('is_locked')
    .eq('organization_id', organizationId)
    .eq('week_ending', weekEndingDate)
    .eq('is_locked', true)
    .limit(1); // We only need one locked row to confirm the schedule is locked
  if (fetchError) {
    throw new Error('Failed to check lock status: ' + fetchError.message);
  
  }
  // If any row is locked, the entire schedule is locked, so skip the upsert
  if (lockedRows.length > 0) {
    throw new Error('Cannot save schedule: the schedule for this week is locked.');
  }
    // Flatten schedule
    const entries = [];
  
    Object.entries(schedule).forEach(([worker, days]) => {
      Object.entries(days).forEach(([day, entry]) => {
        const entryObject = {
          organization_id: organizationId,
          worker_name: worker,
          day_of_week: day,
          worker_role: entry.role,
          location: entry.location || 'Unassigned',
          time: entry.time || '',
          date: entry.date || null,
          week_ending: weekEndingDate,
          is_locked: isScheduleLocked || false, // Use the current lock state from component
        };
        entries.push(entryObject);
      });
    });
    // If no entries to upsert, return early
  if (entries.length === 0) {
    throw new Error('No entries to save.');
  
  }
  
    // Upsert into schedule_entries table
    const { error: upsertError } = await supabase
      .from('schedule_entries')
      .upsert(entries, {
        onConflict: 'organization_id,worker_name,day_of_week,week_ending',
      });
  
  
    if (upsertError) {
      throw new Error('Upsert failed: ' + upsertError.message);
    }
  
  
    return true;
  };
  

  const fetchSchedule = async (weekEndingDate) => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  
    if (sessionError || !session?.user) {
      throw new Error("User not logged in");
    }
  
    const userId = session.user.id;
  
    // Get user's organization ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();
  
    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError);
      return null;
    }
  
    const organizationId = profile.organization_id;
  
    // Fetch schedule rows
    const { data: rows, error: fetchError } = await supabase
      .from('schedule_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEndingDate);
  
    if (fetchError) {
      console.error('Error fetching schedule:', fetchError);
      return null;
    }
  
    // Convert flat rows back to nested structure
    const schedule = {};
    const datesOfWeek = {};
    let isLocked = false;
  
    for (const row of rows) {
      const { worker_name, day_of_week, location, time, date, worker_role, is_locked } = row;
  
      if (!schedule[worker_name]) {
        schedule[worker_name] = {};
      }
  
      schedule[worker_name][day_of_week] = {
        location,
        time,
        date,
        worker_role,
      };
      console.log('here');
      console.log(schedule);
      if (!datesOfWeek[day_of_week]) {
        datesOfWeek[day_of_week] = date;
      }
      isLocked = is_locked; // Set lock state (assumes all rows for week_ending have same is_locked)
    }

    // Fetch unassigned shifts
    const { data: unassignedRows, error: unassignedError } = await supabase
      .from('unassigned_shifts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEndingDate);

    if (unassignedError) {
      console.error('Error fetching unassigned shifts:', unassignedError);
      return null;
    }

    // Set unassigned shifts
    const unassignedShifts = unassignedRows.map((row) => ({
      day: row.day_of_week,
      location: row.location,
      time: row.time,
      date: row.date || '',
      role: row.role || '',
      assignedWorker: '',
    }));
    setUnassignedStations(unassignedShifts);

    const weekEndingDated = new Date(weekEndingDate);

    if (!(weekEndingDated instanceof Date) || isNaN(weekEndingDated)) {
        throw new Error('Invalid date string passed to getWeekDates');
    }
    // Fill map from Sunday to Saturday
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekEndingDated);
        console.log(date);
        date.setDate(weekEndingDated.getDate() - (6 - i));
        console.log(date);
        const formattedDate = date.toISOString().split('T')[0];
        datesOfWeek[daysOfWeek[i]] = formattedDate;
        console.log(datesOfWeek[daysOfWeek[i]]);
    }
    // Fill in unassigned days for each worker
    Object.keys(schedule).forEach((worker) => {
      daysOfWeek.forEach((day) => {
        if (!schedule[worker][day]) {
          schedule[worker][day] = {
            location: 'Unassigned',
            time: '',
            role: worker.role,
          };
        }
      });
    });
    setIsScheduleLocked(isLocked); // Set the lock state

    return { schedule, datesOfWeek };
};

  const deleteSchedule = async (weekEndingDate) => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
    if (sessionError || !session?.user) {
      throw new Error("User not logged in");
    }
  
    const userId = session.user.id;
  
    // Get user's organization ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, user_name')
      .eq('id', userId)
      .single();
  
    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError);
      return null;
    }
  
    const organizationId = profile.organization_id;
    const userName = profile.user_name;
    // Delete schedule rows for the specific week
    const { data, error: deleteError } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEndingDate);
  
    if (deleteError) {
      console.error('Error deleting schedule:', deleteError);
      return { success: false, message: 'Failed to delete schedule.' };
    }
    
    // Delete unassigned shifts for the specific week
    const { error: deleteUnassignedError } = await supabase
      .from('unassigned_shifts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('week_ending', weekEndingDate);

    if (deleteUnassignedError) {
      console.error('Error deleting unassigned shifts:', deleteUnassignedError);
      return { success: false, message: 'Failed to delete unassigned shifts.' };
    }

    const auditLog = {
      organization_id: organizationId,
      worker_name: null,  // Since it's a full schedule deletion, no specific worker
      day_of_week: null,  // No specific day, it's for the whole schedule
      old_location: null,  // No old location, since the schedule is deleted
      old_time: null,  // No old time, since the schedule is deleted
      new_location: null,  // No new location, since it's a deletion
      new_time: null,  // No new time, since it's a deletion
      changed_by: userName,  // Use the user's email or username for "changed_by"
      week_ending: weekEndingDate,
      comments: 'Schedule and unassigned shifts deleted',
    };
  
    // Insert the audit log record into the schedule_audit table
    const { data: auditData, error: auditError } = await supabase
      .from('schedule_audit')
      .insert([auditLog]);
  
    if (auditError) {
      console.error('Error inserting audit log:', auditError);
      return { success: false, message: 'Failed to log audit data.' };
    }
  
    // Return a success message
    return { success: true, message: 'Schedule deleted successfully.' };
};

// Utility functions to parse time ranges
const getShiftStartInMinutes = (timeRange) => {
  if (!timeRange || !timeRange.includes('-')) return 0;
  const [start] = timeRange.split('-');
  const hours = parseInt(start.slice(0, 2), 10);
  const minutes = parseInt(start.slice(2), 10);
  return hours * 60 + minutes;
};

const getShiftEndInMinutes = (timeRange) => {
  if (!timeRange || !timeRange.includes('-')) return 0;
  const [, end] = timeRange.split('-');
  const hours = parseInt(end.slice(0, 2), 10);
  const minutes = parseInt(end.slice(2), 10);
  return hours * 60 + minutes;
};

  const handleDragEnd = async (event) => {
  if (isScheduleLocked) {
    alert('Schedule is locked and cannot be modified.');
    return;
  }
  const { active, over } = event;

  if (!over || active.id === over.id) {
    console.log('No valid drop:', { active, over });
    return;
  }

  try {
    const [sourceWorker, sourceDay] = active.id.split('-');
    const [destWorker, destDay] = over.id.split('-');
    console.log('Source:', { sourceWorker, sourceDay }, 'Destination:', { destWorker, destDay });

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.error('Session error:', sessionError);
      throw new Error('User not logged in');
    }

    const userId = session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, user_name')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      throw new Error('Could not fetch user profile');
    }

    const organizationId = profile.organization_id;
    const userName = profile.user_name;

    // Get the assignments to be swapped
    const sourceAssignment = { ...schedule[sourceWorker][sourceDay] };
    const destAssignment = { ...schedule[destWorker][destDay] };

    // Define non-working statuses
    const nonWorkingStatuses = ['AL', 'N/A', 'REST DAY'];

    // Check if either destination day is a non-working day
    if (nonWorkingStatuses.includes(destAssignment.time)) {
      alert(`Cannot assign shift to ${destWorker} on ${destDay}: Worker is marked as ${destAssignment.time}.`);
      return;
    }
    if (nonWorkingStatuses.includes(sourceAssignment.time)) {
      alert(`Cannot assign shift to ${destWorker} on ${sourceDay}: Worker is marked as ${sourceAssignment.time}.`);
      return;
    }

    // Function to check 12-hour rest period for a worker on a specific day
    const checkRestPeriod = (worker, day, newTime, schedule) => {
      const daysIndex = daysOfWeek.indexOf(day);
      const prevDay = daysIndex > 0 ? daysOfWeek[daysIndex - 1] : null;
      const nextDay = daysIndex < daysOfWeek.length - 1 ? daysOfWeek[daysIndex + 1] : null;
      let hasEnoughRest = true;

      // Skip if newTime is empty or non-working
      if (!newTime || !newTime.includes('-') || nonWorkingStatuses.includes(newTime)) {
        return true; // No shift assigned or non-working day, so rest period check passes
      }

      const currentStartInMinutes = getShiftStartInMinutes(newTime);
      const currentEndInMinutes = getShiftEndInMinutes(newTime);

      // Check rest period from previous day's shift
      if (prevDay && schedule[worker]?.[prevDay]?.time) {
        const prevTime = schedule[worker][prevDay].time;
        // Skip if previous day is non-working
        if (!nonWorkingStatuses.includes(prevTime)) {
          const prevStart = getShiftStartInMinutes(prevTime);
          const prevEnd = getShiftEndInMinutes(prevTime);
          const isPrevOvernight = prevEnd <= prevStart;
          let restMinutes;
          if (!isPrevOvernight) {
            // Non-overnight: (prev end to midnight) + (midnight to current start)
            restMinutes = (1440 - prevEnd) + currentStartInMinutes;
          } else {
            // Overnight: current start - prev end (both from midnight)
            restMinutes = currentStartInMinutes - prevEnd;
          }
          if (restMinutes < 720) {
            hasEnoughRest = false;
          }
        }
      }

      // Check rest period to next day's shift
      if (hasEnoughRest && nextDay && schedule[worker]?.[nextDay]?.time) {
        const nextTime = schedule[worker][nextDay].time;
        // Skip if next day is non-working
        if (!nonWorkingStatuses.includes(nextTime)) {
          const nextStart = getShiftStartInMinutes(nextTime);
          const isCurrentOvernight = currentEndInMinutes <= currentStartInMinutes;
          let restMinutes;
          if (!isCurrentOvernight) {
            // Non-overnight: (current end to midnight) + (midnight to next start)
            restMinutes = (1440 - currentEndInMinutes) + nextStart;
          } else {
            // Overnight: next start - current end (both from midnight)
            restMinutes = nextStart - currentEndInMinutes;
          }
          if (restMinutes < 720) {
            hasEnoughRest = false;
          }
        }
      }

      return hasEnoughRest;
    };

    // Simulate the swap to check rest periods
    const tempSchedule = JSON.parse(JSON.stringify(schedule));
    tempSchedule[sourceWorker][sourceDay] = { ...destAssignment };
    tempSchedule[destWorker][destDay] = { ...sourceAssignment };

    // Check rest periods for both workers
    const sourceWorkerValid = checkRestPeriod(sourceWorker, sourceDay, destAssignment.time, tempSchedule);
    const destWorkerValid = checkRestPeriod(destWorker, destDay, sourceAssignment.time, tempSchedule);

    if (!sourceWorkerValid || !destWorkerValid) {
      alert(
        `Cannot swap shifts: ${
          !sourceWorkerValid ? `${sourceWorker} on ${sourceDay}` : ''
        }${
          !sourceWorkerValid && !destWorkerValid ? ' and ' : ''
        }${
          !destWorkerValid ? `${destWorker} on ${destDay}` : ''
        } would violate the 12-hour rest period rule.`
      );
      return;
    }

    // Proceed with the swap if rest period checks pass
    setSchedule((prevSchedule) => {
      const updatedSchedule = JSON.parse(JSON.stringify(prevSchedule));
      updatedSchedule[sourceWorker][sourceDay] = { ...destAssignment };
      updatedSchedule[destWorker][destDay] = { ...sourceAssignment };

      console.log('After swap:', updatedSchedule);

      // Log audit changes
      setAuditLogBuffer((prevLog) => [
        ...prevLog,
        {
          worker_name: sourceWorker,
          day_of_week: sourceDay,
          field: 'location',
          old_value: sourceAssignment.location,
          new_value: destAssignment.location,
        },
        {
          worker_name: sourceWorker,
          day_of_week: sourceDay,
          field: 'time',
          old_value: sourceAssignment.time,
          new_value: destAssignment.time,
        },
        {
          worker_name: destWorker,
          day_of_week: destDay,
          field: 'location',
          old_value: destAssignment.location,
          new_value: sourceAssignment.location,
        },
        {
          worker_name: destWorker,
          day_of_week: destDay,
          field: 'time',
          old_value: destAssignment.time,
          new_value: sourceAssignment.time,
        },
      ]);

      return updatedSchedule;
    });

    // Trigger auto-save
    setNeedsSave(true);
    console.log('Save triggered');
  } catch (error) {
    console.error('Drag end error:', error);
    alert('Failed to save changes: ' + error.message);
  }
};


  return (
    <div className={`dashboard-container ${isScheduleLocked ? 'locked' : ''}`}>
      <h1 className="dashboard-header">Dashboard</h1>
      <p className="dashboard-description">Welcome to the Dashboard! Below is the schedule for the stations and allocated workers.</p>
      <div className='button-container'>
      <button className="excel-button" onClick={exportToExcel}>
        Export to Excel
      </button>

      <button className="pdf-button" onClick={downloadDashboardAsPDF}>
        Download Dashboard as PDF
      </button>

      <button className="save-button" onClick={handleSave}>
        Save Schedule
      </button>

      {/* New Generate Schedule Button */}
      <button className="generate-schedule-button" onClick={generateNewSchedule}>
        Generate New Schedule
      </button>
      <button onClick={fetchAuditTrail}>View Audit Trail</button>

      {showAuditModal && (
  <div className="audit-modal" onClick={() => setShowAuditModal(false)}>
    <div className="audit-modal-content" onClick={(e) => e.stopPropagation()}>
      <h3>Audit Trail</h3>
      <table>
        <thead>
          <tr>
            <th>Worker</th>
            <th>Day</th>
            <th>Old Location</th>
            <th>New Location</th>
            <th>Old Time</th>
            <th>New Time</th>
            <th>Comments</th>
            <th>Changed At</th>
            <th>Changed By</th>
          </tr>
        </thead>
        <tbody>
          {auditEntries.map((entry, idx) => (
            <tr key={idx}>
              <td>{entry.worker_name}</td>
              <td>{entry.day_of_week}</td>
              <td>{entry.old_location}</td>
              <td>{entry.new_location}</td>
              <td>{entry.old_time}</td>
              <td>{entry.new_time}</td>
              <td>{entry.comments}</td>
              <td>{new Date(new Date(entry.changed_at).getTime() + 60 * 60 * 1000).toLocaleString()}</td>
              <td>{entry.changed_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setShowAuditModal(false)}>Close</button>
    </div>
  </div>
)}
<button
          className="lock-button"
          onClick={async () => {
            const newLockState = !isScheduleLocked;
            setIsScheduleLocked(newLockState);
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session?.user) {
              console.error('Session error:', sessionError);
              return;
            }
            const userId = session.user.id;
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('organization_id, user_name')
              .eq('id', userId)
              .single();
            if (profileError || !profile) {
              console.error('Profile error:', profileError);
              return;
            }
            const organizationId = profile.organization_id;
            const userName = profile.user_name;
            const weekEndingDate = datesOfWeek['Saturday'];
            const { error: updateError } = await supabase
              .from('schedule_entries')
              .update({ is_locked: newLockState })
              .eq('organization_id', organizationId)
              .eq('week_ending', weekEndingDate);
            if (updateError) {
              console.error('Error updating lock state:', updateError);
              alert('Failed to update lock state in database.');
              return;
            }
            await supabase.from('schedule_audit').insert([{
              organization_id: organizationId,
              worker_name: null,
              day_of_week: null,
              old_location: null,
              new_location: null,
              old_time: null,
              new_time: null,
              changed_by: userName,
              week_ending: weekEndingDate,
              comments: newLockState ? 'Schedule Locked' : 'Schedule Unlocked',
            }]);
          }}
        >
          {isScheduleLocked ? 'Unlock Schedule' : 'Lock Schedule'}
        </button>
<div className="search-container">
  {!showDelete ? (
    <button className="search-schedule-button" onClick={() => setShowDelete(true)}>
      Delete
    </button>
  ) : (
    <form
      className="search-form"
      onSubmit={async (e) => {
        e.preventDefault();

        if (!weekEndingDate) {
          alert("Please select a date first.");
          return;
        }
        const confirmed = window.confirm('Are you sure you want to delete the schedule for this week?');
        if (confirmed) {
        const result = await deleteSchedule(weekEndingDate);
        if (result?.success) {
          console.log(result.message);  // Log success message (e.g., 'Schedule deleted successfully.')
          
          // Optionally clear out the state or update UI after deletion
          setSchedule({});  
    
          alert('Schedule deleted successfully.');  // Optionally show a success message to the user
        } else {
          console.error(result?.message);  // Log the error message if deletion fails
          alert('Failed to delete the schedule. Please try again.');
        }
      }
      }}
    > 
      <button 
              className="close-button" 
              onClick={() => setShowDelete(false)} 
              aria-label="Close"
            >
              Close
            </button>
      
      <input
        type="date"
        value={weekEndingDate}
        onChange={(e) => setWeekEndingDate(e.target.value)}
        className="date-input"
      />
      <button type="submit" className="go-button">
        Delete
      </button>
    </form>
  )}
</div>
      <div className="search-container">
  {!showSearch ? (
    <button className="search-schedule-button" onClick={() => setShowSearch(true)}>
      Search
    </button>
  ) : (
    <form
      className="search-form"
      onSubmit={async (e) => {
        e.preventDefault();

        if (!weekEndingDate) {
          alert("Please select a date first.");
          return;
        }

        const result = await fetchSchedule(weekEndingDate);
        if (result) {
          console.log(result.schedule);
          setSchedule(result.schedule);
          setDatesOfWeek(result.datesOfWeek);
          assignStationColors(result.schedule);
        }
      }}
    >
      <button 
              className="close-button" 
              onClick={() => setShowSearch(false)} 
              aria-label="Close"
            >
              Close
            </button>
      <input
        type="date"
        value={weekEndingDate}
        onChange={(e) => setWeekEndingDate(e.target.value)}
        className="date-input"
      />
      <button type="submit" className="go-button">
        Go
      </button>
    </form>
  )}
</div>


      </div>
      {/* Success message notification */}
      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="dashboard-table-wrapper">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Worker</th>
              {daysOfWeek.map((day) => (
  <th key={day}>
    {day} <br />
    {datesOfWeek[day] ?? '—'}
  </th>
))}

              <th>Hours Worked (72hr)</th>
            </tr>
          </thead>
          <tbody>
  {sortedWorkers.map((worker) => (
    <tr key={worker}>
      <td>{worker}</td>
      <SortableContext
        items={daysOfWeek.map((day) => `${worker}-${day}`)}
        strategy={rectSortingStrategy}
      >
        {daysOfWeek.map((day) => {
          const daySchedule = schedule[worker][day];
          const stationColor = getStationColor(daySchedule.location);
          const id = `${worker}-${day}`;
          return (
            <SortableItem
              key={id}
              id={id}
              worker={worker}
              day={day}
              daySchedule={daySchedule}
              stationColor={stationColor}
              handleChange={handleChange}
              setFocusedFieldValue={setFocusedFieldValue}
              calculateShiftDuration={calculateShiftDuration}
              isScheduleLocked={isScheduleLocked}
              handleUnassign={handleUnassign}
              closeAllContextMenus={closeAllContextMenus}
              setContextMenuOpen={setContextMenuOpen}
            />
          );
        })}
      </SortableContext>
      <td>{calculateHoursWorked(schedule[worker])}</td>
    </tr>
  ))}
</tbody>
        </table>
      </div>
      </DndContext>
      {unassignedStations.length > 0 && (
  <div className="unassigned-section">
    <h2>🛠️ Unassigned Stations</h2>
    <table className="unassigned-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Location</th>
          <th>Time</th>
          <th>Role</th>
          <th>Assign to Worker</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) =>
    unassignedStations.map((station, index) =>
      station.day === day ? (
        <tr key={index}>
          <td>{station.day}</td>
          <td>
            <input
              type="text"
              value={station.location}
              onChange={(e) => handleUnassignedChange(index, 'location', e.target.value)}
              disabled={isScheduleLocked}
            />
          </td>
          <td>
            <input
              type="text"
              value={station.time}
              onChange={(e) => handleUnassignedChange(index, 'time', e.target.value)}
              disabled={isScheduleLocked}
            />
          </td>
          <td>{station.role}</td>
          <td>
            <select
              value={station.assignedWorker || ''}
              onChange={(e) => handleUnassignedChange(index, 'assignedWorker', e.target.value)}
              disabled={isScheduleLocked}
            >
              <option value="">Select Worker</option>
              {workers.map((worker, idx) => (
                <option key={idx} value={worker}>
                  {worker}
                </option>
              ))}
            </select>
          </td>
          <td>
            <button onClick={() => assignUnassignedStation(index)} disabled={isScheduleLocked}>
              Assign
            </button>
            <button 
              onClick={() => handleDeleteUnassigned(index)} 
              disabled={isScheduleLocked}
            >
              Delete
            </button>
          </td>
        </tr>
      ) : null
    )
  )}
</tbody>

    </table>
  </div>
)}


    </div>
  );
};

export default Dashboard;
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../supabaseClient';
import './Stations.css';

const capitalizeFirstLetter = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};
const trimString = (str) => (str && typeof str === 'string' ? str.trim() : '');

const excelDateToJS = (excelSerial) => {
  const date = new Date(Math.round((excelSerial - 25569) * 86400 * 1000));
  return date.toISOString().split('T')[0];
};

const Stations = () => {
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [organizationId, setOrganizationId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch organization ID and station data on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
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
          throw new Error("Could not fetch user profile or organization");
        }

        const orgId = profile.organization_id;
        setOrganizationId(orgId);

        // Fetch existing stations
        const { data: stationData, error: stationError } = await supabase
          .from('stations')
          .select('*')
          .eq('organization_id', orgId);

        if (stationError) {
          throw new Error("Error fetching stations");
        }

        setStations(stationData);
      } catch (error) {
        console.error(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !organizationId) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const formattedData = jsonData.map((row) => {
        const normalizedRow = Object.keys(row).reduce((acc, key) => {
          acc[key.toLowerCase()] = row[key];
          return acc;
        }, {});

        return {
          organization_id: organizationId,
          date: typeof normalizedRow.date === 'number'
            ? excelDateToJS(normalizedRow.date)
            : normalizedRow.date || '',
          day: capitalizeFirstLetter(normalizedRow.day || ''),
          location: trimString(normalizedRow.location || ''),
          time: normalizedRow.time || '',
          hours: normalizedRow.hours || '',
          role: normalizedRow.role || '', 
        };
      });

      const { error } = await supabase
        .from('stations')
        .insert(formattedData);

      if (error) {
        console.error('Upload error:', error.message);
      } else {
        // Refetch the updated station list
        const { data: updatedStations, error: fetchError } = await supabase
          .from('stations')
          .select('*')
          .eq('organization_id', organizationId);

        if (fetchError) {
          console.error('Fetch after insert error:', fetchError.message);
        } else {
          setStations(updatedStations);
        }
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleRowDoubleClick = (station) => {
    setSelectedStation(station);
    setShowModal(true);
  };

  const handleModalInputChange = (field, value) => {
    setSelectedStation((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveModal = async () => {
    const { error } = await supabase
      .from('stations')
      .update({
        date: selectedStation.date,
        day: capitalizeFirstLetter(selectedStation.day),
        location: trimString(selectedStation.location),
        time: selectedStation.time,
        hours: selectedStation.hours,
        role: selectedStation.role,
      })
      .eq('id', selectedStation.id);

    if (error) {
    console.error('Update error:', error.message);
  } else {
    const updatedList = stations.map((s) =>
      s.id === selectedStation.id
        ? {
            ...selectedStation,
            day: capitalizeFirstLetter(selectedStation.day),
            location: trimString(selectedStation.location),
          }
        : s
    );
    setStations(updatedList);
    setShowModal(false);
  }
};

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedStation(null);
  };

  const handleClearData = async () => {
    if (!organizationId) return;

    const { error } = await supabase
      .from('stations')
      .delete()
      .eq('organization_id', organizationId);

    if (error) {
      console.error('Delete error:', error.message);
    } else {
      setStations([]);
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className="stations-container">
      <h1>Stations</h1>

      <input
        type="file"
        accept=".xlsx, .xls"
        onChange={handleFileUpload}
        className="mb-4"
      />

      <button
        onClick={handleClearData}
        className="mb-4 px-4 py-2 bg-red-500 text-white rounded"
      >
        Clear Data
      </button>

      {stations.length === 0 && <p>No data loaded</p>}

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Location</th>
            <th>Time</th>
            <th>Hours</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((station) => (
            <tr
              key={station.id}
              onDoubleClick={() => handleRowDoubleClick(station)}
              className="clickable-row"
            >
              <td>{station.date}</td>
              <td>{station.day}</td>
              <td>{station.location}</td>
              <td>{station.time}</td>
              <td>{station.hours}</td>
              <td>{station.role}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && selectedStation && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Edit Station</h2>
            <label>
              Date:
              <input
                type="text"
                value={selectedStation.date}
                onChange={(e) => handleModalInputChange('date', e.target.value)}
              />
            </label>
            <label>
              Day:
              <input
                type="text"
                value={selectedStation.day}
                onChange={(e) => handleModalInputChange('day', e.target.value)}
              />
            </label>
            <label>
              Location:
              <input
                type="text"
                value={selectedStation.location}
                onChange={(e) => handleModalInputChange('location', e.target.value)}
              />
            </label>
            <label>
              Time:
              <input
                type="text"
                value={selectedStation.time}
                onChange={(e) => handleModalInputChange('time', e.target.value)}
              />
            </label>
            <label>
              Hours:
              <input
                type="text"
                value={selectedStation.hours}
                onChange={(e) => handleModalInputChange('hours', e.target.value)}
              />
            </label>
            <label>
              Role:
              <input
                type="text"
                value={selectedStation.role}
                onChange={(e) => handleModalInputChange('role', e.target.value)}
              />
            </label>
            <div>
              <button onClick={handleSaveModal}>Save</button>
              <button onClick={handleCloseModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Stations;
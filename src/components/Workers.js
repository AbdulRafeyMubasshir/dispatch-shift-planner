import React, { useState, useEffect } from 'react';
import './Workers.css';
import { supabase } from '../supabaseClient';

const Workers = () => {
  const [workers, setWorkers] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [workerToDelete, setWorkerToDelete] = useState(null);
  const [organizationId, setOrganizationId] = useState(null);
  

  // Fetch organization_id of logged-in user
  useEffect(() => {
    const fetchOrganizationId = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        console.error("User not logged in");
        return;
      }

      const userId = session.user.id;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        console.error("Could not fetch user profile or organization");
        return;
      }

      setOrganizationId(profile.organization_id);
    };

    fetchOrganizationId();
  }, []);

  // Fetch workers for this organization
  useEffect(() => {
    const fetchWorkers = async () => {
      if (!organizationId) return;

      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching workers:', error);
      } else {
        setWorkers(data);
      }
    };

    fetchWorkers();
  }, [organizationId]);

  const handleRowDoubleClick = (worker) => {
    setSelectedWorker({
      ...worker,
      canworkstations: Array.isArray(worker.canworkstations)
        ? worker.canworkstations.join(', ')
        : '', // fallback in case it's null/undefined
    });
    setShowModal(true);
  };
  

  const handleModalInputChange = (field, value) => {
    setSelectedWorker((prev) => ({
      ...prev,
      [field]: field === 'canworkstations'
        ? value // store the value as a string (not an array)
        : value,
    }));
  };
  
  

  const handleSaveModal = async () => {
    // Trim the name field to remove leading/trailing spaces
  const trimmedName = selectedWorker.name.trim();

    // Convert canworkstations string to array before saving
    const updatedWorker = {
      ...selectedWorker,
      name: trimmedName, // Use trimmed name
      canworkstations: selectedWorker.canworkstations
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    };
  
    if (updatedWorker.id) {
      // Update existing worker
      const { data, error } = await supabase
        .from('workers')
        .update({
          name: updatedWorker.name,
          canworkstations: updatedWorker.canworkstations, // Save array form
          monday: updatedWorker.monday,
          tuesday: updatedWorker.tuesday,
          wednesday: updatedWorker.wednesday,
          thursday: updatedWorker.thursday,
          friday: updatedWorker.friday,
          saturday: updatedWorker.saturday,
          sunday: updatedWorker.sunday,
          role: updatedWorker.role,
          email: updatedWorker.email,
          mobile_number: updatedWorker.mobile_number,
          payroll_number: updatedWorker.payroll_number,
        })
        .eq('id', updatedWorker.id)
        .select();
  
      if (error) {
        console.error('Error updating worker:', error);
      } else {
        setWorkers((prevWorkers) =>
          prevWorkers.map((worker) =>
            worker.id === updatedWorker.id ? data[0] : worker
          )
        );
      }
    } else {
      // Insert new worker
      const { data, error } = await supabase
        .from('workers')
        .insert([{ ...updatedWorker, organization_id: organizationId }])
        .select();
  
      if (error) {
        console.error('Error saving new worker:', error);
      } else {
        setWorkers((prevWorkers) => [...prevWorkers, data[0]]);
      }
    }
  
    // Close modal and reset selected worker
    setShowModal(false);
    setSelectedWorker(null);
  };
  
  

  const handleDeleteWorker = async () => {
    const { error } = await supabase
      .from('workers')
      .delete()
      .eq('id', workerToDelete.id);

    if (error) {
      console.error('Error deleting worker:', error);
    } else {
      setWorkers((prev) => prev.filter((w) => w.id !== workerToDelete.id));
      setShowDeleteConfirm(false);
      setWorkerToDelete(null);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedWorker(null);
  };

  const handleAddWorker = () => {
    setSelectedWorker({
      name: '',
      canworkstations: '',
      monday: '',
      tuesday: '',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: '',
    });
    setShowModal(true);
  };

  const handleOpenDeleteConfirm = (worker) => {
    setWorkerToDelete(worker);
    setShowDeleteConfirm(true);
  };

  const handleCloseDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setWorkerToDelete(null);
  };

  return (
    <div className="workers-container">
      <div className="sticky-header">
  <h1>Workers</h1>
  <button
    onClick={handleAddWorker}
    className="mb-4 px-4 py-2 bg-green-500 text-white rounded"
  >
    Add New Worker
  </button>
</div>


      {workers.length === 0 && <p>No data loaded</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Sunday</th>
            <th>Monday</th>
            <th>Tuesday</th>
            <th>Wednesday</th>
            <th>Thursday</th>
            <th>Friday</th>
            <th>Saturday</th>
            <th>Can Work Stations</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr
              key={worker.id}
              onDoubleClick={() => handleRowDoubleClick(worker)}
              className="clickable-row"
            >
              <td>{worker.name}</td>
              <td>{worker.sunday}</td>
              <td>{worker.monday}</td>
              <td>{worker.tuesday}</td>
              <td>{worker.wednesday}</td>
              <td>{worker.thursday}</td>
              <td>{worker.friday}</td>
              <td>{worker.saturday}</td>
              <td>{worker.canworkstations?.join(', ')}</td>
              <td>{worker.role}</td>
              <td>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenDeleteConfirm(worker);
                  }}
                  className="bg-red-500 text-white px-2 py-1 rounded"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Are you sure you want to delete this worker?</h2>
            <p>{workerToDelete?.name}</p>
            <div className="modal-buttons">
              <button
                onClick={handleDeleteWorker}
                className="bg-red-500 text-white px-4 py-2 rounded"
              >
                Yes, Delete
              </button>
              <button
                onClick={handleCloseDeleteConfirm}
                className="bg-gray-500 text-white px-4 py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Add Modal */}
      {showModal && selectedWorker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{selectedWorker.id ? 'Edit Worker' : 'Add New Worker'}</h2>
            <label>
              Name:
              <input
                type="text"
                value={selectedWorker.name}
                onChange={(e) => handleModalInputChange('name', e.target.value)}
              />
            </label>
            {['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => (
              <label key={day}>
                {day.charAt(0).toUpperCase() + day.slice(1)}:
                <select
            value={selectedWorker[day] || ''}
            onChange={(e) => handleModalInputChange(day, e.target.value)}
          >
            <option value="">Select</option>
            <option value="Early">Early</option>
            <option value="Late">Late</option>
            <option value="Night">Night</option>
            <option value="Early/Late">Early or Late</option>
            <option value="Early/Night">Early or Night</option>
            <option value="Night/Late">Night or Late</option>
            <option value="Any">Any</option>
            <option value="N/A">N/A</option>
            <option value="AL">AL</option>
          </select>
              </label>
            ))}
            <label>
  Can Work Stations:
  <input
    type="text"
    value={selectedWorker.canworkstations}  // Now using the string form (not an array)
    onChange={(e) => handleModalInputChange('canworkstations', e.target.value)}  // Directly handle string input
  />
</label>
<label>
        Role:
        <input
          type="text"
          value={selectedWorker.role || ''}
          onChange={(e) => handleModalInputChange('role', e.target.value)}
        />
      </label>

      {/* New Fields to be displayed */}
      <label>
        Email:
        <input
          type="email"
          value={selectedWorker.email || ''}
          onChange={(e) => handleModalInputChange('email', e.target.value)}
        />
      </label>

      <label>
        Mobile Number:
        <input
          type="text"
          value={selectedWorker.mobile_number || ''}
          onChange={(e) => handleModalInputChange('mobile_number', e.target.value)}
        />
      </label>

      <label>
        Payroll Number:
        <input
          type="text"
          value={selectedWorker.payroll_number || ''}
          onChange={(e) => handleModalInputChange('payroll_number', e.target.value)}
        />
      </label>

            <div className="modal-buttons">
              <button onClick={handleSaveModal} className="bg-blue-500 text-white px-4 py-2 rounded">Save</button>
              <button onClick={handleCloseModal} className="bg-gray-500 text-white px-4 py-2 rounded">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workers;
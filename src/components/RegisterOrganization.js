import React, { useState } from 'react';
import bcrypt from 'bcryptjs'; // Import bcryptjs to hash the password
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const RegisterOrganization = () => {
  const [orgName, setOrgName] = useState('');
  const [orgPassword, setOrgPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleRegisterOrg = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Hash the organization password
    const hashedPassword = await bcrypt.hash(orgPassword, 10); // 10 is the salt rounds

    // Insert organization with hashed password
    const { error: insertError } = await supabase
      .from('organizations')
      .insert([{ name: orgName, secret: hashedPassword }]);

    if (insertError) {
      setError('Failed to register organization: ' + insertError.message);
    } else {
      setSuccess('Organization registered successfully!');
      // Optionally redirect or clear fields
      setOrgName('');
      setOrgPassword('');
      // navigate('/login'); // or wherever you want
    }
  };

  return (
    <form onSubmit={handleRegisterOrg}>
      <h2>Register Organization</h2>
      <input
        placeholder="Organization Name"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Organization Password"
        value={orgPassword}
        onChange={(e) => setOrgPassword(e.target.value)}
        required
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
      <button type="submit">Create Organization</button>
    </form>
  );
};

export default RegisterOrganization;

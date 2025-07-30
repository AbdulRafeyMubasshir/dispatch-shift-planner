import React, { useState } from 'react';
import bcrypt from 'bcryptjs'; // Import bcryptjs to compare the hashed password
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const RegisterUser = () => {
  const [orgName, setOrgName] = useState('');
  const [orgPassword, setOrgPassword] = useState('');
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleRegisterUser = async (e) => {
    e.preventDefault();
    setError('');

    // Step 1: Lookup organization
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('name', orgName)
      .single();

    if (orgError || !orgData) {
      setError('Invalid organization name.');
      return;
    }

    // Step 2: Verify organization password
    const passwordMatch = await bcrypt.compare(orgPassword, orgData.secret);
    if (!passwordMatch) {
      setError('Incorrect organization password.');
      return;
    }

    // Step 3: Register user in Supabase Auth
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    const userId = signUpData.user?.id;

    // Step 4: Create user profile and link to organization
    const { error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: userId,
          organization_id: orgData.id,
          user_name: userName,
          role: 'member',
        },
      ]);

    if (profileError) {
      setError("Profile creation failed: " + profileError.message);
      return;
    }

    navigate('/dashboard');
  };

  return (
    <form onSubmit={handleRegisterUser}>
      <h2>Register as User</h2>
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
      <input
        placeholder="User Name"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        required
      />
      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit">Register User</button>
    </form>
  );
};

export default RegisterUser;

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import './Register.css';

const Register = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Reference to scroll to the bottom of the page or container
  const bottomRef = useRef(null);

  // Scroll to the bottom when the error message is set
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [error]); // Scroll when the error message changes

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(''); // Clear previous errors

    const { user, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message); // Set error message if registration fails
    } else {
      navigate('/dashboard'); // Redirect to the dashboard after successful registration
    }
  };

  return (
    <div className="register-container">
      <h2>Register</h2>
      <form onSubmit={handleRegister}>
        <div>
          <label>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit">Register</button>
      </form>

      <div className="login-link">
        <p>Already have an account? <a href="/login">Login here</a></p>
      </div>

      {/* Scroll reference to scroll to the bottom */}
      <div ref={bottomRef} />
    </div>
  );
};

export default Register;

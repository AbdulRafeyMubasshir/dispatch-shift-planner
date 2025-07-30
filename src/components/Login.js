import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // Importing useNavigate hook for redirection
import { supabase } from '../supabaseClient'; // Import Supabase client
import './Login.css'; // Importing the CSS file

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const navigate = useNavigate(); // Hook to navigate to different routes
  
  // Reference to scroll to the bottom of the page or container
  const bottomRef = React.useRef(null);

  // Scroll to the bottom when the component mounts
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [error]); // Scroll when the error message changes

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); // Clear previous errors

    // Login user with email and password
    const { user, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message); // Set error message if login fails
    } else {
      navigate('/dashboard'); // Redirect to the dashboard after successful login
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
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
        <button type="submit">Login</button>
      </form>
    
      <div className="register-link">
        <p>Go to Home <a href="/">Click here</a></p>
      </div>
      
      {/* Scroll reference to scroll to the bottom */}
      <div ref={bottomRef} />
    </div>
  );
};

export default Login;

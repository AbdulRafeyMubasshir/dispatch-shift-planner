import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient'; // Make sure the correct path to supabaseClient is set
import './Navigation.css';

function Navigation({ user }) {
  const location = useLocation(); // Correct usage of useLocation() inside Router

  // Only show the navigation bar if the user is not on the login or register page
  if (location.pathname === '/login' || location.pathname === '/register') {
    return null;
  }

  return (
    <nav>
      <ul style={{ display: 'flex', listStyleType: 'none', padding: 0 }}>
        <li style={{ margin: '0 10px' }}>
          <Link to="/dashboard">Dashboard</Link>
        </li>
        <li style={{ margin: '0 10px' }}>
          <Link to="/workers">Workers</Link>
        </li>
        <li style={{ margin: '0 10px' }}>
          <Link to="/stations">Stations</Link>
        </li>
        {!user ? (
          <>
            <li style={{ margin: '0 10px' }}>
              <Link to="/login">Login</Link>
            </li>
            <li style={{ margin: '0 10px' }}>
              <Link to="/registeruser">Register User</Link>
            </li>
            <li style={{ margin: '0 10px' }}>
              <Link to="/registerorganization">Register Organization</Link>
            </li>
          </>
        ) : (
          <li style={{ margin: '0 10px' }}>
            <button onClick={() => supabase.auth.signOut()}>Logout</button>
          </li>
        )}
      </ul>
    </nav>
  );
}

export default Navigation;

import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Workers from './components/Workers';
import Stations from './components/Stations';
import Register from './components/Register';
import Login from './components/Login';
import RegisterOrganization from './components/RegisterOrganization';
import RegisterUser from './components/RegisterUser';
import ProtectedRoute from './components/ProtectedRoute'; // ProtectedRoute component to protect routes
import { supabase } from './supabaseClient'; // Supabase client

import Navigation from './components/Navigation'; // Import the Navigation component

import './App.css';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error(error);
        setUser(null);
      } else {
        setUser(data);
      }
    };

    fetchUser();

    // Listen for auth state changes and store the subscription
    const authListener = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUser(session?.user || null);
      }
    );

    // Cleanup function for authListener
    return () => {
      authListener?.subscription?.unsubscribe();  // Unsubscribe from the auth listener
    };
  }, []);

  return (
    <Router>
      <Navigation user={user} />
      <div className="App">
      
        <Routes>
          {/* Routes for Registration and Login */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registerorganization" element={<RegisterOrganization />} />
          <Route path="/registeruser" element={<RegisterUser />} />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workers"
            element={
              <ProtectedRoute>
                <Workers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stations"
            element={
              <ProtectedRoute>
                <Stations />
              </ProtectedRoute>
            }
          />
        </Routes>
        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} Elegent Trends Pvt. Ltd. All rights reserved.</p>
        </footer>
      </div>
    </Router>
    
  );
}

export default App;
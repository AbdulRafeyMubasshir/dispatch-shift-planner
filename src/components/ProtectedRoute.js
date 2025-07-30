// src/components/ProtectedRoute.js
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient'; // Import Supabase client

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error(error);
        setIsAuthenticated(false);
      } else {
        setIsAuthenticated(!!data);
      }
    };

    checkUser();

    // Listen for auth state changes and store the subscription
    const authListener = supabase.auth.onAuthStateChange(
      (_, session) => {
        setIsAuthenticated(!!session?.user);
      }
    );

    // Cleanup function for the auth listener
    return () => {
      authListener?.subscription?.unsubscribe();  // Unsubscribe from the auth listener
    };
  }, []);

  if (!isAuthenticated) {
    return <p>You must be logged in to access this page.</p>;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

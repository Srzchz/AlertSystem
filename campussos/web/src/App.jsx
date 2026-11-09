import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { clearSession, getToken, getUser } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Records from './pages/Records.jsx';

function Protected({ children }) {
  const user = getUser();
  if (!getToken() || !user) return <Navigate to="/login" replace />;
  if (user.role === 'user') {
    clearSession();
    return <Navigate to="/login" replace />;
  }
  return children;
}

function Shell({ children }) {
  const navigate = useNavigate();
  const user = getUser();
  return (
    <>
      <header className="topbar">
        <span className="brand">CampusSOS Infirmary</span>
        <nav>
          <NavLink to="/" end>Live alerts</NavLink>
          <NavLink to="/records">Records</NavLink>
        </nav>
        <span className="who">{user?.name}</span>
        <button className="btn" onClick={() => { clearSession(); navigate('/login'); }}>Log out</button>
      </header>
      {children}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Shell><Dashboard /></Shell></Protected>} />
      <Route path="/records" element={<Protected><Shell><Records /></Shell></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

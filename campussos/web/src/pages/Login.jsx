import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveSession } from '../api.js';
import Logo from '../components/Logo.jsx';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email, password } });
      if (data.user.role === 'user') throw new Error('This dashboard is for infirmary staff. Use the mobile app to send an SOS.');
      saveSession(data);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="logo-big"><Logo size={44} /></div>
        <h1>CampusSOS</h1>
        <p>Infirmary response dashboard</p>
        <span className="gold-bar" />
        <ul>
          <li>Instant alarm when someone sends an SOS</li>
          <li>Live location on the campus map</li>
          <li>Records of every incident and response time</li>
        </ul>
      </aside>
      <main className="auth-form">
        <form className="login" onSubmit={submit}>
          <h2>Staff log in</h2>
          <div className="meta">Sign in to respond to emergency alerts</div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <label htmlFor="pw">Password</label>
          <div className="pw">
            <input id="pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
          {error && <p className="error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        </form>
      </main>
    </div>
  );
}

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();
const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role });

// Public registration always creates a normal user. Responder/admin accounts come from the seed script or an admin.
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!name || !email || !password || password.length < 8)
      return res.status(400).json({ error: 'Name, email and a password of 8+ characters are required' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'That email is already registered' });
    const user = await User.create({ name, email, phone, password: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: (email || '').toLowerCase() }).select('+password');
    if (!user || !(await bcrypt.compare(password || '', user.password)))
      return res.status(401).json({ error: 'Wrong email or password' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;

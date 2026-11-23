import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

await mongoose.connect(process.env.MONGODB_URI);
const email = process.env.SEED_RESPONDER_EMAIL;
if (await User.findOne({ email })) {
  console.log('Responder already exists:', email);
} else {
  await User.create({
    name: 'Infirmary Nurse',
    email,
    role: 'responder',
    password: await bcrypt.hash(process.env.SEED_RESPONDER_PASSWORD, 10),
  });
  console.log('Created responder:', email);
}
await mongoose.disconnect();

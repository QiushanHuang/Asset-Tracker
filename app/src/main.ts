import { bootstrapApp } from './app/bootstrap';
import './styles/base.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app mount node');
}

void bootstrapApp(target).catch((error) => {
  console.error('Failed to bootstrap app', error);
  target.textContent = 'Failed to bootstrap local book.';
});

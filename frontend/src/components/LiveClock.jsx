import { useEffect, useState } from 'react';
import { currentTime } from '../lib/time.js';

export function LiveClock({ className }) {
  const [time, setTime] = useState(currentTime);
  useEffect(() => {
    const id = setInterval(() => setTime(currentTime()), 1000);
    return () => clearInterval(id);
  }, []);
  return <p className={className}>{time}</p>;
}

import React from 'react';
import { GameCanvas } from './components/GameCanvas';

export default function App() {
  return (
    <div className="w-screen h-screen bg-slate-900 overflow-hidden">
      <GameCanvas />
    </div>
  );
}
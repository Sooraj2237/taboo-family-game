import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import GameRoom from './components/GameRoom';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-800 rounded-xl shadow-2xl p-6 border border-slate-700">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomCode" element={<GameRoom />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App

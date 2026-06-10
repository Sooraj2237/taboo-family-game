import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://${window.location.hostname}:5000`

export default function Home() {
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const apiCall = async (endpoint, payload) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rooms/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || 'Something went wrong');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleCreateRoom = async () => {
    setError('');
    if (!username.trim()) return setError('Please enter a name first.');
    
    const data = await apiCall('create', { username });
    if (data) {
      // Navigate to the room and pass the username securely in React state
      navigate(`/room/${data.roomCode}`, { state: { username } });
    }
  };

  const handleJoinRoom = async () => {
    setError('');
    if (!username.trim()) return setError('Please enter a name first.');
    if (!roomCode.trim() || roomCode.length !== 4) return setError('Enter a valid 4-letter room code.');

    const data = await apiCall('join', { username, roomCode });
    if (data) {
      navigate(`/room/${data.roomCode}`, { state: { username } });
    }
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-linear-to-r from-blue-400 to-purple-500 mb-2">
          TABOO
        </h1>
        <p className="text-slate-400 text-sm">Family Game Night Edition</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g., Amma, Appa"
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-slate-500"
          />
        </div>

        <div className="pt-2">
          <button 
            onClick={handleCreateRoom}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            Create New Game
          </button>
        </div>

        <div className="relative flex items-center py-2">
          <div className="flexgrow border-t border-slate-700"></div>
          <span className="flexshrink-0 mx-4 text-slate-500 text-sm">OR JOIN EXISTING</span>
          <div className="flexgrow border-t border-slate-700"></div>
        </div>

        <div className="flex space-x-2">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="4-LETTER CODE"
            maxLength={4}
            className="w-2/3 px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-slate-500 uppercase tracking-widest"
          />
          <button 
            onClick={handleJoinRoom}
            className="w-1/3 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
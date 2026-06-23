import { useEffect, useState, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_BACKEND_URL || `http://${window.location.hostname}:5000`);

export default function GameRoom() {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const username = location.state?.username;

  const [players, setPlayers] = useState([]);
  const [teamAScore, setTeamAScore] = useState(0);
  const [teamBScore, setTeamBScore] = useState(0);
  
  const [currentCard, setCurrentCard] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [winner, setWinner] = useState(null); 

  const [chatMessages, setChatMessages] = useState([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!username) { navigate('/'); return; }

    socket.emit('join_room', { roomCode, username });

    socket.on('room_update', (roomData) => {
      setPlayers(roomData.players);
      setTeamAScore(roomData.teamAScore);
      setTeamBScore(roomData.teamBScore);
    });

    socket.on('new_card', (card) => {
      setCurrentCard(card);
      setIsPlaying(true);
      setWinner(null); // Ensure victory screen is hidden if a new card is dealt
      // There is a chance of overlap of the zero count and the new card
      // In such a senario the card is dealt first and then the victory screen
    });

    socket.on('timer_update', (time) => setTimeLeft(time));

    socket.on('turn_ended', () => {
      setIsPlaying(false);
      setTimeLeft(0);
      setChatMessages(prev => [...prev, { sender: 'SYSTEM', text: '⏱️ Time is up! Next team, get ready!', isSystem: true }]);
    });

    socket.on('chat_message', (msg) => setChatMessages((prev) => [...prev, msg]));

    socket.on('game_over', (data) => {
      setIsPlaying(false);
      setTimeLeft(null);
      setWinner(data.winner);
    });

    return () => {
      socket.off('room_update');
      socket.off('new_card');
      socket.off('timer_update');
      socket.off('turn_ended');
      socket.off('chat_message');
      socket.off('game_over');
    };
  }, [roomCode, username, navigate]);
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);
  
  const me = players.find(p => p.username === username) || { team: 'Unassigned', role: 'Waiting' };
  
  const handleStartGame = () => {
    setChatMessages([]); 
    socket.emit('start_game', { roomCode });
  };
  
  const handleJoinTeam = (teamName) => socket.emit('join_team', { roomCode, username, team: teamName });
  const handleManualCorrect = () => socket.emit('manual_correct', { roomCode, username });
  const handleSkip = () => socket.emit('skip_card', { roomCode, username });
  const handleBuzz = () => socket.emit('judge_buzz', { roomCode, username });
  
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (currentGuess.trim()) {
      socket.emit('chat_message', { roomCode, username, role: me.role, message: currentGuess });
      setCurrentGuess('');
    }
  };
  
  const handleLeaveRoom = () => {
    socket.emit('leave_room', { roomCode, username });
    navigate('/'); 
  };

  const handleResetRoom = () => {
    if (window.confirm("Are you sure you want to reset the scores and end the current round?")) {
      socket.emit('reset_room', { roomCode, username });
    }
  };

  const teamA = players.filter(p => p.team === 'A');
  const teamB = players.filter(p => p.team === 'B');
  const unassigned = players.filter(p => p.team === 'Unassigned');

  // THE VICTORY SCREEN
  if (winner) {
    return (
      <div className="flex flex-col h-[90vh] items-center justify-center space-y-8 animate-in zoom-in duration-500">
        <div className="text-8xl animate-bounce">🏆</div>
        <div className="text-center">
          <h1 className={`text-6xl font-black uppercase tracking-widest ${winner === 'A' ? 'text-blue-500' : 'text-purple-500'}`}>
            TEAM {winner} WINS!
          </h1>
          <p className="text-xl text-slate-300 mt-4 font-bold">
            Final Score: Team A ({teamAScore}) - Team B ({teamBScore})
          </p>
        </div>
        <button 
          onClick={() => setWinner(null)}
          className="bg-green-600 hover:bg-green-500 text-white font-bold text-xl py-4 px-12 rounded-full shadow-[0_0_30px_rgba(22,163,74,0.6)] transition-all active:scale-95"
        >
          Play Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[90vh]">
      <div className="flex justify-between items-center bg-slate-900 border border-slate-700 p-4 rounded-xl mb-4 shadow-sm">
        <div className="text-center">
            <p className="text-xs text-blue-400 font-bold">TEAM A</p>
            <p className="text-2xl font-black text-white">{teamAScore}</p>
        </div>
        <div className="text-center flex flex-col items-center">
          <h2 className="text-sm font-bold text-slate-500 tracking-widest mb-1">{roomCode}</h2>
          {timeLeft !== null && (
            <div className={`text-3xl font-black ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-100'}`}>
              {timeLeft}s
            </div>
          )}
        </div>
        <div className="text-center">
            <p className="text-xs text-purple-400 font-bold">TEAM B</p>
            <p className="text-2xl font-black text-white">{teamBScore}</p>
        </div>
      </div>

      <div className="grow bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col relative overflow-hidden shadow-xl">
        {/* ACTIVE GAMEPLAY */}
        {isPlaying && currentCard ? (
          <div className="w-full h-full flex flex-col animate-in fade-in duration-300">
            <div className="flex-none flex items-center justify-center mb-4">
              {(me.role === 'Speaker' || me.role === 'Judge') && (
                <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden relative border-2 border-slate-200">
                  {me.role === 'Judge' && (
                    <div className="absolute top-0 w-full bg-red-600 text-white text-center text-xs font-bold py-1 uppercase tracking-widest z-10 animate-pulse">
                      You are Judging
                    </div>
                  )}
                  <div className={`text-white text-center py-4 px-4 border-b-4 ${me.role === 'Judge' ? 'bg-slate-800 border-red-600 mt-4' : 'bg-blue-600 border-blue-800'}`}>
                    <h3 className="text-2xl font-black tracking-wide uppercase">{currentCard.targetWord}</h3>
                  </div>
                  
                  <div className="bg-slate-100 py-3 px-8 flex flex-col space-y-2 max-h-[25vh] overflow-y-auto shadow-inner">
                    {currentCard.tabooWords.map((word, index) => (
                      <div key={index} className="text-center">
                        <span className="text-lg font-bold text-slate-800 uppercase tracking-wider">{word}</span>
                        {index < currentCard.tabooWords.length - 1 && <hr className="border-slate-300 mt-2 mx-auto w-1/2" />}
                      </div>
                    ))}
                  </div>
                  
                  {me.role === 'Speaker' && (
                    <div className="p-3 bg-slate-200 flex space-x-2 border-t border-slate-300">
                      <button onClick={handleSkip} className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 rounded-lg shadow active:scale-95 transition-all text-sm">Skip</button>
                      <button onClick={handleManualCorrect} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg shadow active:scale-95 transition-all text-sm">Correct (+1)</button>
                    </div>
                  )}
                  {me.role === 'Judge' && (
                    <div className="p-3 bg-slate-200 border-t border-slate-300">
                      <button onClick={handleBuzz} className="w-full bg-red-600 hover:bg-red-700 text-white font-black text-2xl py-4 rounded-xl shadow-[0_0_15px_rgba(220,38,38,0.5)] active:scale-95 transition-all">BUZZ! (-1)</button>
                    </div>
                  )}
                </div>
              )}
              {me.role === 'Guesser' && (
                <div className="w-full py-4 flex flex-col items-center">
                  <div className="bg-slate-900 border-2 border-blue-500 rounded-full w-20 h-20 flex items-center justify-center animate-bounce shadow-[0_0_30px_rgba(59,130,246,0.3)] mb-4">
                    <span className="text-3xl">🗣️</span>
                  </div>
                  <h2 className="text-xl font-black text-white">Listen Closely!</h2>
                </div>
              )}
            </div>

            <div className="grow flex flex-col bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
              <div className="grow overflow-y-auto p-4 space-y-2">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`text-sm ${msg.isSystem ? 'text-green-400 font-bold text-center my-2 bg-green-900/20 py-2 rounded' : 'text-slate-300'}`}>
                    {!msg.isSystem && <span className="font-bold text-blue-400 mr-2">{msg.sender}:</span>}
                    <span>{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              {(me.role === 'Guesser' || me.role === 'Speaker') ? (
                <form onSubmit={handleSendMessage} className="p-3 bg-slate-800 border-t border-slate-700 flex space-x-2">
                  <input type="text" value={currentGuess} onChange={(e) => setCurrentGuess(e.target.value)} placeholder={me.role === 'Speaker' ? "Type a hint..." : "Type your guess..."} className="grow bg-slate-900 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold transition-colors">Send</button>
                </form>
              ) : (
                <div className="p-3 bg-slate-800 border-t border-slate-700 text-center text-xs text-slate-500 font-bold tracking-widest uppercase">Watch for taboo words</div>
              )}
            </div>
          </div>
        ) : (
          /* LOBBY */
          <div className="h-full flex flex-col items-center justify-center space-y-6 w-full">
            {timeLeft === 0 && (
              <div className="w-full max-w-2xl bg-blue-900/40 border border-blue-500 rounded-lg p-4 mb-4 text-center">
                <h3 className="text-xl font-bold text-white uppercase tracking-widest">Turn Over!</h3>
                <p className="text-blue-300 text-sm">Teams have rotated. Next team, get ready!</p>
              </div>
            )}

            <h3 className="text-2xl font-bold text-white tracking-wide">Form Your Teams</h3>
            {unassigned.length > 0 && (
              <div className="w-full bg-yellow-500/10 border border-yellow-500/50 text-yellow-400 p-3 rounded-lg text-sm text-center">
                Waiting for {unassigned.length} player(s)...
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {unassigned.map(p => <span key={p.username} className="bg-slate-900 px-2 py-1 rounded text-xs">{p.username}</span>)}
                </div>
              </div>
            )}
            <div className="flex flex-col md:flex-row w-full gap-4 max-w-2xl">
              <div className={`flex-1 rounded-xl p-4 border-2 transition-all ${me.team === 'A' ? 'bg-blue-900/40 border-blue-500' : 'bg-slate-900 border-slate-700'}`}>
                <h4 className="text-blue-400 font-black text-lg mb-3 flex justify-between items-center border-b border-slate-700 pb-2">TEAM A <span>{teamA.length}</span></h4>
                <ul className="space-y-2 min-h-25">
                  {teamA.map((p, idx) => (
                    <li key={idx} className="text-slate-200 font-medium flex items-center space-x-3 bg-slate-800 p-2 rounded">
                      <span className="w-6 h-6 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-xs">{p.username.charAt(0).toUpperCase()}</span><span>{p.username}</span>
                    </li>
                  ))}
                </ul>
                {me.team !== 'A' && <button onClick={() => handleJoinTeam('A')} className="w-full mt-4 bg-slate-800 hover:bg-blue-600 text-slate-300 font-semibold py-2 rounded text-sm">Join Team A</button>}
              </div>
              <div className={`flex-1 rounded-xl p-4 border-2 transition-all ${me.team === 'B' ? 'bg-purple-900/40 border-purple-500' : 'bg-slate-900 border-slate-700'}`}>
                <h4 className="text-purple-400 font-black text-lg mb-3 flex justify-between items-center border-b border-slate-700 pb-2">TEAM B <span>{teamB.length}</span></h4>
                <ul className="space-y-2 min-h-25">
                  {teamB.map((p, idx) => (
                    <li key={idx} className="text-slate-200 font-medium flex items-center space-x-3 bg-slate-800 p-2 rounded">
                      <span className="w-6 h-6 rounded bg-purple-600 text-white flex items-center justify-center font-bold text-xs">{p.username.charAt(0).toUpperCase()}</span><span>{p.username}</span>
                    </li>
                  ))}
                </ul>
                {me.team !== 'B' && <button onClick={() => handleJoinTeam('B')} className="w-full mt-4 bg-slate-800 hover:bg-purple-600 text-slate-300 font-semibold py-2 rounded text-sm">Join Team B</button>}
              </div>
            </div>
            <button onClick={handleStartGame} disabled={unassigned.length > 0 || teamA.length < 2 || teamB.length < 2} className="w-full max-w-sm bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg py-4 rounded-xl shadow-[0_0_20px_rgba(22,163,74,0.4)] disabled:shadow-none mt-4">START TURN</button>
            <div className="flex justify-between items-center mb-4 px-1">
              <button 
                onClick={handleLeaveRoom}
                className="text-xs text-red-400 hover:text-white hover:bg-red-600 font-bold px-4 py-2 bg-slate-900 rounded-lg border border-red-900/50 transition-colors shadow-sm"
              >
                ← LEAVE ROOM
              </button>
              <button 
                onClick={handleResetRoom}
                className="text-xs text-yellow-500 hover:text-white hover:bg-yellow-600 font-bold px-4 py-2 bg-slate-900 rounded-lg border border-yellow-900/50 transition-colors shadow-sm"
              >
                ↻ RESET GAME
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
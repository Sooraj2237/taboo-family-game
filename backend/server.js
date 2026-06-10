const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const roomRoutes = require('./routes/room');
const Room = require('./models/Room');
const Card = require('./models/Card');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use('/api/rooms', roomRoutes);

const io = new Server(server, {
    cors: { origin: [process.env.FRONTEND_URL, "http://localhost:5173"], methods: ["GET", "POST"] }
});

const activeTimers = {}; 
const activeCards = {}; 
const WINNING_SCORE = 15; // The target score to win the game!

// Helper function to check if a team won
const checkWinCondition = async (roomCode, room) => {
    if (room.teamAScore >= WINNING_SCORE || room.teamBScore >= WINNING_SCORE) {
        const winner = room.teamAScore >= WINNING_SCORE ? 'A' : 'B';
        
        if (activeTimers[roomCode]) {
            clearInterval(activeTimers[roomCode]);
            delete activeTimers[roomCode];
        }

        io.to(roomCode).emit('game_over', { winner });

        // Reset the room for the next game
        room.teamAScore = 0;
        room.teamBScore = 0;
        room.activeTeam = 'A';
        room.players.forEach(p => p.role = 'Waiting');
        await room.save();

        io.to(roomCode).emit('room_update', { 
            players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore
        });
        return true;
    }
    return false;
};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('join_room', async ({ roomCode, username }) => {
        socket.join(roomCode);
        try {
            const room = await Room.findOne({ roomCode });
            if (room) io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });
        } catch (err) { console.error(err); }
    });

    socket.on('join_team', async ({ roomCode, username, team }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (room) {
                const playerIndex = room.players.findIndex(p => p.username === username);
                if (playerIndex !== -1) {
                    room.players[playerIndex].team = team;
                    room.markModified('players'); 
                    await room.save();
                    io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });
                }
            }
        } catch (err) { console.error(err); }
    });

    socket.on('start_game', async ({ roomCode }) => {
        if (activeTimers[roomCode]) clearInterval(activeTimers[roomCode]);

        try {
            const room = await Room.findOne({ roomCode });
            if (!room) return;

            const currentTurnTeam = room.activeTeam; 
            const opposingTeam = currentTurnTeam === 'A' ? 'B' : 'A';
            const activeTeamPlayers = room.players.filter(p => p.team === currentTurnTeam);
            
            if (activeTeamPlayers.length > 0) {
                const speakerIndex = Math.floor(Math.random() * activeTeamPlayers.length);
                const speakerName = activeTeamPlayers[speakerIndex].username;

                room.players.forEach(p => {
                    if (p.team === currentTurnTeam) p.role = (p.username === speakerName) ? 'Speaker' : 'Guesser';
                    else if (p.team === opposingTeam) p.role = 'Judge';
                });
            }

            room.activeTeam = opposingTeam; // Swap turns for next round
            room.markModified('players');
            await room.save();

            io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });

            const randomCardData = await Card.aggregate([{ $sample: { size: 1 } }]);
            if (randomCardData.length > 0) {
                activeCards[roomCode] = randomCardData[0].targetWord.toLowerCase();
                io.to(roomCode).emit('new_card', randomCardData[0]);
            }

            let timeLeft = 60;
            io.to(roomCode).emit('timer_update', timeLeft);

            activeTimers[roomCode] = setInterval(() => {
                timeLeft--;
                io.to(roomCode).emit('timer_update', timeLeft);
                if (timeLeft <= 0) {
                    clearInterval(activeTimers[roomCode]);
                    delete activeTimers[roomCode];
                    io.to(roomCode).emit('turn_ended');
                }
            }, 1000);
        } catch (err) { console.error(err); }
    });

    // --- SCORING & CHAT ---
    socket.on('chat_message', async ({ roomCode, username, role, message }) => {
        const currentWord = activeCards[roomCode];
        if (currentWord && message.toLowerCase().trim() === currentWord && role === 'Guesser') {
            try {
                const room = await Room.findOne({ roomCode });
                if (room) {
                    if (room.activeTeam === 'A') room.teamAScore += 1;
                    if (room.activeTeam === 'B') room.teamBScore += 1;
                    await room.save();

                    io.to(roomCode).emit('chat_message', { sender: 'SYSTEM', text: `🎉 ${username} guessed it: ${currentWord.toUpperCase()}!`, isSystem: true });
                    io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });

                    const isWin = await checkWinCondition(roomCode, room);
                    if (isWin) return; // Stop if game is over

                    const randomCardData = await Card.aggregate([{ $sample: { size: 1 } }]);
                    if (randomCardData.length > 0) {
                        activeCards[roomCode] = randomCardData[0].targetWord.toLowerCase();
                        io.to(roomCode).emit('new_card', randomCardData[0]);
                    }
                }
            } catch (err) { console.error(err); }
        } else {
            io.to(roomCode).emit('chat_message', { sender: username, text: message });
        }
    });

    socket.on('manual_correct', async ({ roomCode, username }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (room) {
                if (room.activeTeam === 'A') room.teamAScore += 1;
                if (room.activeTeam === 'B') room.teamBScore += 1;
                await room.save();

                io.to(roomCode).emit('chat_message', { sender: 'SYSTEM', text: `✅ ${username} marked a correct guess!`, isSystem: true });
                io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });

                const isWin = await checkWinCondition(roomCode, room);
                if (isWin) return;

                const randomCardData = await Card.aggregate([{ $sample: { size: 1 } }]);
                if (randomCardData.length > 0) {
                    activeCards[roomCode] = randomCardData[0].targetWord.toLowerCase();
                    io.to(roomCode).emit('new_card', randomCardData[0]);
                }
            }
        } catch (err) { console.error(err); }
    });

    socket.on('judge_buzz', async ({ roomCode, username }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (room) {
                if (room.activeTeam === 'A') room.teamAScore -= 1;
                if (room.activeTeam === 'B') room.teamBScore -= 1;
                await room.save();

                io.to(roomCode).emit('chat_message', { sender: 'SYSTEM', text: `🚨 BUZZ! Taboo word used! -1 point.`, isSystem: true });
                io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });

                const randomCardData = await Card.aggregate([{ $sample: { size: 1 } }]);
                if (randomCardData.length > 0) {
                    activeCards[roomCode] = randomCardData[0].targetWord.toLowerCase();
                    io.to(roomCode).emit('new_card', randomCardData[0]);
                }
            }
        } catch (err) { console.error(err); }
    });

    socket.on('skip_card', async ({ roomCode, username }) => {
        io.to(roomCode).emit('chat_message', { sender: 'SYSTEM', text: `⏭️ Card skipped.`, isSystem: true });
        try {
            const randomCardData = await Card.aggregate([{ $sample: { size: 1 } }]);
            if (randomCardData.length > 0) {
                activeCards[roomCode] = randomCardData[0].targetWord.toLowerCase();
                io.to(roomCode).emit('new_card', randomCardData[0]);
            }
        } catch (err) { console.error(err); }
    });

    // --- MANUAL ROOM RESET ---
    socket.on('reset_room', async ({ roomCode, username }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (room) {
                // 1. Kill the active timer if there is one
                if (activeTimers[roomCode]) {
                    clearInterval(activeTimers[roomCode]);
                    delete activeTimers[roomCode];
                }
                
                // 2. Wipe scores and roles (but keep the teams intact)
                room.teamAScore = 0;
                room.teamBScore = 0;
                room.activeTeam = 'A';
                room.players.forEach(p => {
                    p.role = 'Waiting';
                });
                
                room.markModified('players');
                await room.save();

                // 3. Broadcast the wipe to all phones
                io.to(roomCode).emit('turn_ended'); // Hides the card
                io.to(roomCode).emit('game_over', { winner: null }); // Hides the victory screen
                io.to(roomCode).emit('room_update', { 
                    players: room.players, teamAScore: 0, teamBScore: 0 
                });
                io.to(roomCode).emit('chat_message', { 
                    sender: 'SYSTEM', text: `♻️ ${username} reset the game!`, isSystem: true 
                });
            }
        } catch (err) { console.error("Reset error:", err); }
    });

    socket.on('leave_room', async ({ roomCode, username }) => {
        // 1. Unplug the specific socket from the room channel
        socket.leave(roomCode);
        console.log(`${username} left room ${roomCode}`);

        try {
            // 2. Find the room in MongoDB
            const room = await Room.findOne({ roomCode });
            if (room) {
                // 3. Filter the leaving player out of the array
                room.players = room.players.filter(p => p.username !== username);
                
                room.markModified('players');
                await room.save();

                // 4. Tell all the remaining phones to update their UI
                io.to(roomCode).emit('room_update', { 
                    players: room.players, 
                    teamAScore: room.teamAScore, 
                    teamBScore: room.teamBScore 
                });

                // 5. Drop a system message in the chat
                io.to(roomCode).emit('chat_message', { 
                    sender: 'SYSTEM', 
                    text: `👋 ${username} left the game.`, 
                    isSystem: true 
                });
            }
        } catch (err) { 
            console.error("Error updating DB on leave:", err); 
        }
    });
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log('MongoDB Connected!')).catch(console.error);
app.get('/', (req, res) => res.send('API Running'));
server.listen(process.env.PORT || 5000, () => console.log('Server running...'));
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
const WINNING_SCORE = 15; 

const checkWinCondition = async (roomCode, room) => {
    if (room.teamAScore >= WINNING_SCORE || room.teamBScore >= WINNING_SCORE) {
        const winner = room.teamAScore >= WINNING_SCORE ? 'A' : 'B';
        
        if (activeTimers[roomCode]) {
            clearInterval(activeTimers[roomCode]);
            delete activeTimers[roomCode];
        }

        io.to(roomCode).emit('game_over', { winner });

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

    // --- BULLETPROOF JOIN ROOM ---
    socket.on('join_room', async ({ roomCode, username }) => {
        socket.join(roomCode);
        try {
            let room = await Room.findOne({ roomCode });
            if (room) {
                const playerExists = room.players.some(p => p.username === username);
                if (!playerExists && username) {
                    // $push forces MongoDB to append the player directly
                    room = await Room.findOneAndUpdate(
                        { roomCode },
                        { $push: { players: { username, team: 'Unassigned', role: 'Waiting' } } },
                        { new: true }
                    );
                }
                io.to(roomCode).emit('room_update', { 
                    players: room.players, 
                    teamAScore: room.teamAScore, 
                    teamBScore: room.teamBScore 
                });
            }
        } catch (err) { console.error(err); }
    });

    // --- BULLETPROOF JOIN TEAM ---
    socket.on('join_team', async ({ roomCode, username, team }) => {
        try {
            let room = await Room.findOne({ roomCode });
            if (room) {
                const playerExists = room.players.some(p => p.username === username);
                
                if (playerExists) {
                    // $set targets the specific array element and forces the update
                    room = await Room.findOneAndUpdate(
                        { roomCode, "players.username": username },
                        { $set: { "players.$.team": team } },
                        { new: true } // Returns the newly updated document
                    );
                } else {
                    // Race condition fix: push them back directly
                    room = await Room.findOneAndUpdate(
                        { roomCode },
                        { $push: { players: { username, team: team, role: 'Waiting' } } },
                        { new: true }
                    );
                }
                
                if (room) {
                    io.to(roomCode).emit('room_update', { 
                        players: room.players, 
                        teamAScore: room.teamAScore, 
                        teamBScore: room.teamBScore 
                    });
                }
            }
        } catch (err) { 
            console.error("Error in join_team:", err); 
        }
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

            room.activeTeam = opposingTeam; 
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
                    if (isWin) return; 

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

    socket.on('reset_room', async ({ roomCode, username }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (room) {
                if (activeTimers[roomCode]) {
                    clearInterval(activeTimers[roomCode]);
                    delete activeTimers[roomCode];
                }
                
                room.teamAScore = 0;
                room.teamBScore = 0;
                room.activeTeam = 'A';
                room.players.forEach(p => { p.role = 'Waiting'; });
                
                room.markModified('players');
                await room.save();

                io.to(roomCode).emit('turn_ended'); 
                io.to(roomCode).emit('game_over', { winner: null }); 
                io.to(roomCode).emit('room_update', { 
                    players: room.players, teamAScore: 0, teamBScore: 0 
                });
                io.to(roomCode).emit('chat_message', { 
                    sender: 'SYSTEM', text: `♻️ ${username} reset the game!`, isSystem: true 
                });
            }
        } catch (err) { console.error("Reset error:", err); }
    });

    // --- BULLETPROOF LEAVE ROOM ---
    socket.on('leave_room', async ({ roomCode, username }) => {
        socket.leave(roomCode);
        console.log(`${username} left room ${roomCode}`);

        try {
            // $pull safely targets and deletes the player directly from MongoDB
            const room = await Room.findOneAndUpdate(
                { roomCode },
                { $pull: { players: { username: username } } },
                { new: true } 
            );

            if (room) {
                io.to(roomCode).emit('room_update', { 
                    players: room.players, 
                    teamAScore: room.teamAScore, 
                    teamBScore: room.teamBScore 
                });

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
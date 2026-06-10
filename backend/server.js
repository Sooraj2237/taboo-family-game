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
    cors: { origin: "*", methods: ["GET", "POST"] }
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

    // --- INDESTRUCTIBLE JOIN ROOM ---
    socket.on('join_room', async ({ roomCode, username }) => {
        socket.join(roomCode);
        try {
            let room = await Room.findOne({ roomCode });
            if (room) {
                const exists = room.players.some(p => p.username === username);
                if (!exists && username) {
                    // Force the player back into the database if missing
                    await Room.updateOne(
                        { roomCode }, 
                        { $push: { players: { username, team: 'Unassigned', role: 'Waiting' } } }
                    );
                    room = await Room.findOne({ roomCode }); // Re-fetch updated room
                }
                io.to(roomCode).emit('room_update', { players: room.players, teamAScore: room.teamAScore, teamBScore: room.teamBScore });
            }
        } catch (err) { console.error(err); }
    });

    // --- INDESTRUCTIBLE JOIN TEAM ---
    socket.on('join_team', async ({ roomCode, username, team }) => {
        try {
            // 1. Force MongoDB to directly update the exact player's team
            let result = await Room.updateOne(
                { roomCode: roomCode, "players.username": username },
                { $set: { "players.$.team": team } }
            );

            // 2. If the player was wiped by a refresh, push them directly to the array
            if (result.matchedCount === 0) {
                await Room.updateOne(
                    { roomCode: roomCode },
                    { $push: { players: { username: username, team: team, role: 'Waiting' } } }
                );
            }

            // 3. Fetch the fresh room and send it to all players
            const updatedRoom = await Room.findOne({ roomCode });
            if (updatedRoom) {
                io.to(roomCode).emit('room_update', { 
                    players: updatedRoom.players, teamAScore: updatedRoom.teamAScore, teamBScore: updatedRoom.teamBScore 
                });
            }
        } catch (err) { console.error("Error in join_team:", err); }
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

    // --- INDESTRUCTIBLE LEAVE ROOM ---
    socket.on('leave_room', async ({ roomCode, username }) => {
        socket.leave(roomCode);
        console.log(`${username} left room ${roomCode}`);

        try {
            // Force MongoDB to delete the player instantly
            const updatedRoom = await Room.findOneAndUpdate(
                { roomCode },
                { $pull: { players: { username: username } } },
                { new: true }
            );

            if (updatedRoom) {
                io.to(roomCode).emit('room_update', { 
                    players: updatedRoom.players, teamAScore: updatedRoom.teamAScore, teamBScore: updatedRoom.teamBScore 
                });
                io.to(roomCode).emit('chat_message', { 
                    sender: 'SYSTEM', text: `👋 ${username} left the game.`, isSystem: true 
                });
            }
        } catch (err) { console.error("Error updating DB on leave:", err); }
    });
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log('MongoDB Connected!')).catch(console.error);
app.get('/', (req, res) => res.send('API Running'));
server.listen(process.env.PORT || 5000, () => console.log('Server running...'));
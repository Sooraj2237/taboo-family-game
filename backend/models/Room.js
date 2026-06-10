const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    username : { type: String, required: true },
    team : { type: String, default: 'Unassigned' },
    role : { type: String, default: 'Waiting' }
}, {_id: false});

const roomSchema = new mongoose.Schema({
    roomCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    host: {
        type: String,
        required: true
    },
    players: [playerSchema],
    teamAScore: { type: Number, default: 0 },
    teamBScore: { type: Number, default: 0 },
    activeTeam: { type: String, default: 'A' },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('Room', roomSchema);
const { initializeApp } = require("firebase-admin/app");

initializeApp();

const { matchStudentToRide } = require("./matchStudentToRide");
const { onRideCompleted } = require("./onRideCompleted");
const { processScheduledRides } = require("./processScheduledRides");

exports.matchStudentToRide = matchStudentToRide;
exports.onRideCompleted = onRideCompleted;
exports.processScheduledRides = processScheduledRides;

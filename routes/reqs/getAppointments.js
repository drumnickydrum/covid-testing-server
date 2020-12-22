const { logger } = require('../../logger');
const Appointment = require('../../models/Appointment.model');

const getAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find({ _id, client: req.user._id });
    return res.json(appointments);
  } catch (err) {
    logger.error(`/appointments GET => \n ${e.stack}`);
    return res.status(500).send('An error occurred. Please try again later.');
  }
};

module.exports = getAppointments;

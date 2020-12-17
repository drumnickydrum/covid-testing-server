const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const ensureAuthenticated = require('../tools/ensureAuthenticated.js');
const { ObjectId } = require('mongodb');
const createTruthyObject = require('../tools/createTruthyObject.js');
const Client = require('../models/Client.model.js');
const Location = require('../models/Location.model.js');

// return all locations
router.route('/locations').get((req, res) => {
  Location.find()
    .then((locations) => res.json(locations))
    .catch((err) => res.status(400).json(err));
});

// register new client
router.route('/register').post((req, res) => {
  // parse request
  const { email, password } = req.body;
  // hash client password
  const hash = bcrypt.hashSync(password, 12);
  // create new client from Client Schema
  const newClient = new Client({ email, password: hash });
  // check if client already registered
  Client.findOne({ email: newClient.email })
    .then((client) => {
      // if email exists, return false
      if (client) {
        return res.send(false);
      } else {
        // save new client to db
        newClient
          .save()
          .then((user) => {
            // login client to session
            req.login(user, (err) => {
              if (!err) {
                return res.send('success');
              } else {
                return res.status(400).send('post-register login error');
              }
            });
          })
          .catch((err) => res.status(400).send('post-save error'));
      }
    })
    .catch((err) => res.status(400).send('find error'));
});

// client login
router
  .route('/login')
  .post(passport.authenticate('clientLocal'), (req, res, next) => {
    res.send('success');
  });

// add an appointment
router.route('/appointments').post(ensureAuthenticated, async (req, res) => {
  // parse request
  const { client, name, dob, phone, date, time, location, test } = req.body;
  // find requested location
  const dbLocation = await Location.findById(location, {}, (err) => {
    if (err) return res.send('location not found');
  });
  for (let appt of dbLocation.appointments) {
    // if appointment date and time already taken
    if (appt.date === date && appt.time === time) {
      return res.send('unavailable');
    }
  }
  // create new appointment with unique mongo _id
  const _id = new ObjectId();
  // add it to location's appointments array
  dbLocation.appointments.unshift({
    date,
    time,
    test,
    client,
    name,
    dob,
    phone,
    _id,
  });
  // save location
  dbLocation
    .save()
    .then(async () => {
      // adjust appointment for client's document
      const newAppointment = {
        date,
        time,
        location,
        name: dbLocation.name,
        address: dbLocation.address,
        phone: dbLocation.phone,
        test,
        confirmation: _id,
      };
      // find client
      let dbClient = await Client.findById(client, {}, (err) => {
        if (err) return res.status(400).send('client not found');
      });
      // add appointment to client's appointments array
      dbClient.appointments.unshift(newAppointment);
      dbClient
        .save()
        .then((client) => res.json(client))
        .catch((err) => res.status(400).send(err));
    })
    .catch((err) => res.status(400).send(err));
});

// get all client appointments
router.route('/appointments').get(ensureAuthenticated, async (req, res) => {
  // parse request
  const client = req.body.client;
  // find client
  const clientDoc = await Client.findById(client, {}, (err) => {
    if (err) return res.status(400).send('client not found');
  });
  // return client appointments array
  return res.json(clientDoc.appointments);
});

// delete client appointment
router.route('/appointments').delete(ensureAuthenticated, async (req, res) => {
  // parse request
  const { client, location, confirmation } = req.body;
  // require request fields
  if (!client || !location || !confirmation)
    return res.status(400).send('required fields missing');
  // find appointment location
  const dbLocation = await Location.findById(location, {}, (err) => {
    if (err) return res.status(400).send('location not found');
  });
  // confirmed false until we find the appointment
  let confirmed = false;
  for (let [index, appt] of Object.entries(dbLocation.appointments)) {
    if (appt._id.toString() === confirmation) {
      // remove it from location's appointments array
      dbLocation.appointments.splice(index, 1);
      confirmed = true;
    }
  }
  // if we don't find it, return bad request
  if (!confirmed) return res.status(400).send('invalid confirmation number');
  // save location
  dbLocation
    .save()
    .then(async () => {
      // find client
      let dbClient = await Client.findById(client, {}, (err) => {
        if (err) return res.status(400).send('client not found');
      });
      // now look for appointment in client's appointments array
      for (let [index, appt] of Object.entries(dbClient.appointments)) {
        if (appt.confirmation.toString() === confirmation)
          // remove it
          dbClient.appointments.splice(index, 1);
      }
      // save client
      dbClient
        .save()
        .then((client) => res.json(client))
        .catch((err) => res.status(400).send('didnt save'));
    })
    .catch((err) => res.status(400).send(err));
});

// update client profile
router.route('/update/:type').post(ensureAuthenticated, async (req, res) => {
  // type of update
  const type = req.params.type;
  // parse request, include only values to be updated
  let request = createTruthyObject(req.body);
  if (!request.client) return res.send('must provide client id');
  // no need to add client field to db
  delete request.client;
  // find client
  let dbClient = await Client.findById(req.body.client, (err) => {
    if (err) return res.status(400).send('location not found');
  });
  // check type of update
  switch (type) {
    case 'insurance':
    case 'basic':
      for (let [key, val] of Object.entries(request)) {
        // if value exists in request, change it in client document
        if (val) dbClient[key] = val;
      }
      break;
    case 'emergency_contact':
    case 'address':
      dbClient[type] = Object.assign({}, dbClient[type], request);
      break;
    case 'password':
      // obviously a lot more than this;
      dbClient.password = request.password;
      break;
    case 'travel':
      // add new travel history at front
      dbClient.travel = [request, ...dbClient.travel];
      break;
    default:
      return res.status(400).send('invalid update');
  }
  // save client
  dbClient
    .save()
    .then((client) => res.json(client))
    .catch((err) => res.status(400).json(err));
});

// get client document
router.route('/').get(ensureAuthenticated, (req, res) => {
  // parse request
  let client = req.body.client;
  // find client
  Client.findById(client, {}, (err) => {
    if (err) return res.status(400).send('client not found');
  }).then((client) => res.json(client));
});

// client logout *** where does this go???
router.route('/logout').get((req, res) => {
  console.log('trying');
  req.logout();
  res.redirect('/'); // ???
});

// catch all invalid endpoints
router.use((req, res, next) => {
  res.status(404).type('text').send('Not Found');
});

module.exports = router;

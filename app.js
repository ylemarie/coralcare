/*** INSTALL ***/
/*
 npm install jsonfile underscore express http socket.io dateformat onoff moment twix
*/

/*** PARAMETERS ***/

//read parameters from json file
var jsonfile = require('jsonfile');
var _ = require("underscore");
var file = 'parameters.json';
var parameters = jsonfile.readFileSync(file);
function getParam( pname) {
    return _.find( parameters, {name: pname} ).value;
}
function getParamIdx( pname ) {
    return _.findIndex( parameters, {name: pname} );
}
function setParam( pname, newValue ) {
   parameters[ getParamIdx( pname ) ].value = newValue;
}

//populate "const"
var CHECK_PERIOD = getParam('CHECK_PERIOD');    // used ?
var SERVER_PORT = getParam('SERVER_PORT');      // http server port
var DEBUG = getParam('DEBUG');                  // debug mode
var LOG = getParam('LOG');                      // log mode
var TPS = getParam('TPS');                      // Time Periods definition

if (DEBUG) { 
    console.log("Nbr parameters: "+parameters.length); 
}

/*** SERVER & SOCKET ***/

//Server & socket
var express = require('express');
app = express();
server = require('http').createServer(app);
io = require('socket.io').listen(server);
server.listen(SERVER_PORT);    //start server
app.use(express.static('public'));  //static page
if (DEBUG) { console.log("Running web on port %s",SERVER_PORT); }

/*** DATE ***/
var moment     = require('moment');            //http://momentjs.com/docs
var twix       = require('twix');              //http://isaaccambron.com/twix.js/
var dateFormat = require('dateformat');        //https://github.com/felixge/node-dateformat


/*** TIME PERIOD ***/

//get ratio pwm for 1 specific hour
function getPwm(hour) { 
    if (LOG) { console.log("Looking for TP (" + hour + ") -----------------"); }
    var rampe_pwm = { blue: -1, white: -1};
    if ( !(TPS[0].hour < hour && hour < TPS[TPS.length-1].hour) ) { //hour is in implicit period (night)
        tp1 = TPS[TPS.length-1];
        tp2 = TPS[0];
        if (DEBUG) { console.log( 'night: ' + hour + " (" + TPS[TPS.length-1].hour + "-" + TPS[0].hour +")" ); }
        if (LOG) { console.log('TP1-TP2', tp1, tp2 ); }
        var ratio = ratioPwm(tp1, tp2, hour);
    } else {    //find hour in TPS
        for( i = 0; i < TPS.length-1; i++ ) {
            tp1 = TPS[i];
            tp2 = TPS[i+1];
            if ( tp1.hour <= hour  && hour <= tp2.hour) {
                if (DEBUG) { console.log( tp1.hour + " <= " + hour + " < " + tp2.hour); }
                if (LOG) { console.log( 'TP1-TP2', tp1, tp2 ); }
                var ratio = ratioPwm(tp1, tp2, hour);
            }
        }
    }
    return ratio;
}

//get TimePeriod of 1 specific hour
function getTP(hour) {  
    if (DEBUG) { console.log("Looking for TP (" + hour + ") -----------------"); }
    var tp = {}
    if ( !(TPS[0].hour < hour && hour < TPS[TPS.length-1].hour) ) { //hour is in implicit period (night)
        tp1 = TPS[TPS.length-1];
        tp2 = TPS[0];
        if (DEBUG) { console.log( 'night: ' + hour + " (" + TPS[TPS.length-1].hour + "-" + TPS[0].hour +")" ); }
        if (DEBUG) { console.log('TP1-TP2', tp1, tp2 ); }
        tp = {tp1, tp2};
    } else {    //find hour in TPS
        for( i = 0; i < TPS.length-1; i++ ) {
            tp1 = TPS[i];
            tp2 = TPS[i+1];
            if ( tp1.hour <= hour  && hour <= tp2.hour) {
                if (DEBUG) { console.log( tp1.hour + " <= " + hour + " < " + tp2.hour); }
                if (DEBUG) { console.log( 'TP1-TP2', tp1, tp2 ); }
                tp = {tp1, tp2};
            }
        }
    }
    return tp;
}

//ratio calcul
function ratioPwm(tp1, tp2, hour) {
    var duree_tp = moment("2000-01-01T" + tp1.hour).twix("2000-01-01T" + tp2.hour).count('minutes')-1;  //nb minutes of time period
    if ( duree_tp < 0 ) {   //momment lost in calcul in case 23:00-08:00
        var duree_tp_before00h = moment("2000-01-01T" + tp1.hour).twix("2000-01-01T24:00").count('minutes')-1;
        var duree_tp_after00h = moment("2000-01-01T00:00").twix("2000-01-01T"  + tp2.hour).count('minutes')-1;
        if (DEBUG) { console.log("night detected !" + duree_tp_before00h + "+" + duree_tp_after00h); }
        duree_tp = duree_tp_before00h + duree_tp_after00h;
        
        if ( tp1.hour <= hour && hour <= "24:00" ) {
            var duree_hour_before00h = moment("2000-01-01T" + hour).twix("2000-01-01T24:00").count('minutes')-1;        //nb minutes since time period begin
            var duree_hour_after00h = 0;            
        } else {
            var duree_hour_before00h = moment("2000-01-01T" + tp1.hour).twix("2000-01-01T24:00").count('minutes')-1;
            var duree_hour_after00h = moment("2000-01-01T00:00").twix("2000-01-01T" + hour).count('minutes')-1;         //nb minutes since time period begin
        }
        var duree_hour = duree_hour_before00h + duree_hour_after00h;
    } else {
        var duree_hour = moment("2000-01-01T" + tp1.hour).twix("2000-01-01T" + hour).count('minutes')-1;                //nb minutes since time period begin
    }

    //ratio 1 min = % increase/decrease by minute
    ratio_1min = {
            blue: Math.round( (tp2.blue-tp1.blue)/duree_tp * 100 ),
            white: Math.round( (tp2.white-tp1.white)/duree_tp * 100 ),
    }   
    if (DEBUG) { console.log( "TP:" + duree_tp ); console.log( "Hour:" + duree_hour + " min"); console.log( ratio_1min ); }

    //ratio in %
    ratio = { 
        blue:  Math.round( (ratio_1min.blue * duree_hour)/100 + tp1.blue ),
        white: Math.round( (ratio_1min.white * duree_hour)/100 + tp1.white ) 
    }

    //FIX problem with round @ 2 min before tp1 => ratio < 0
    if ( ratio.blue < 0 ) { 
        ratio.blue = 0; 
        if (DEBUG) { console.log( "!!! FIX ratio.blue < 0", ratio ); }
    }
    if ( ratio.white < 0 ) { 
        ratio.white = 0; 
        if (DEBUG) { console.log( "!!! FIX ratio.white < 0", ratio ); }
    }
    
    return ratio;
}

/***  SERVO PI ***/
var servopi = require('./ABElectronics_NodeJS_Libraries/lib/servopi/servopi');
var pwm = new ServoPi(0x40);    // create an servopi object
pwm.setPWMFrequency(1000);      // Set PWM frequency to 1 Khz and enable the output
pwm.outputEnable();

/*** Envoi infos page web ***/
var loop = setInterval(function(){
    infos_obj = {
        oscillo1: { pos: servo.getPosition(1,250), ralenti: OSCILLO[0].ralenti, start: OSCILLO[0].start, stop: OSCILLO[0].stop, state: OSCILLO_STATE[0] },
        oscillo2: { pos: servo.getPosition(2,250), ralenti: OSCILLO[1].ralenti, start: OSCILLO[1].start, stop: OSCILLO[1].stop, state: OSCILLO_STATE[1] },
        oscillo3: { pos: servo.getPosition(3,250), ralenti: OSCILLO[2].ralenti, start: OSCILLO[2].start, stop: OSCILLO[2].stop, state: OSCILLO_STATE[2] },
        oscillo4: { pos: servo.getPosition(4,250), ralenti: OSCILLO[3].ralenti, start: OSCILLO[3].start, stop: OSCILLO[3].stop, state: OSCILLO_STATE[3] }
    }; 
    io.sockets.emit('oscillator', {infos:infos_obj} );
}, CHECK_PERIOD * 1000)

/*** Ecoute socket de page web */
io.sockets.on('connection', function (socket) {
    //debug
    socket.emit('message', 'Vous êtes bien connecté !');

    // Quand le serveur reçoit un signal de type "startstop" du client    
    socket.on('startstop', function (data) {
        //console.log('Un client me parle ! Il me dit : ' + data);
        state = data.state;
        console.log("Socket startstop state:"+state);
        if (state == ON) {
            console.log("STOP");
            /*
            for (i=0; i<NB_OSCILLOS; i++) {
                OSCILLO_STATE[i] = OFF;
                console.log("move servo "+(i+1)+" to "+OSCILLO_START[i]);
            }
            resetPos = setInterval(function() {
                console.log("resetPos");
                servo.move(1, OSCILLO[0].start, 250);
                servo.move(2, OSCILLO[1].start, 250);
                servo.move(3, OSCILLO[2].start, 250);
                servo.move(4, OSCILLO[3].start, 250);
            }, 1000);
            //servo.sleep();  //pas la peine c'est le move ave STATE OFF qui les bloque
            */
        } else { //OFF
            console.log("START");
            /*
            for (i=0; i<NB_OSCILLOS; i++) {
                OSCILLO_STATE[i] = ON;
            }
            */
            console.log("clear resetPos");
            clearInterval(resetPos);
            //servo.wake();
        }
    }); 

    socket.on('oscillomove', function (data) {
        num = data.oscillo;
        sens = data.sens;
        steps = data.steps;
        console.log("Socket oscillomove num:"+num+" sens:"+sens+" steps:"+steps);
        if (OSCILLO_STATE[0] == OFF) { //ts les oscillos dans le meme état
            console.log("clear resetPos depuis oscillomove");
            clearInterval(resetPos);

            destination = servo.getPosition(num, 250) + steps*sens;
            console.log("destination:"+destination);
            if (destination >= 250) {
                destination = 250;
                console.log("Max 250!");
            }
            if (destination <= 1) {
                destination = 1;
                console.log("Mini 1!");
            }         
            servo.move(num, destination, 250);
        } else { //ON
            console.log("Can't move oscillos ON");
        }
    });

    socket.on('oscillomovelimite', function (data) {
        num = data.oscillo;
        limite = data.limite;
        console.log("Socket oscillomovelimite num:"+num+" limite:"+limite);
        if (OSCILLO_STATE[0] == OFF) { //ts les oscillos dans le meme état
            console.log("clear resetPos depuis oscillomovelimite");
            clearInterval(resetPos);

            destination = limite;
            console.log("destination:"+destination);
            if (destination >= 250) {
                destination = 250;
                console.log("Max 250!");
            }
            if (destination <= 1) {
                destination = 1;
                console.log("Mini 1!");
            }
            servo.move(num, destination, 250);
        } else { //ON
            console.log("Can't move oscillos ON");
        }
    });

    socket.on('save', function (data) {
        num = parseInt(data.oscillo);
        limite = data.limite;
        val = parseInt(data.value);
        ralenti = parseInt(data.ralenti);
        console.log("Socket save num:"+num+" limite:"+limite+" val:"+val+" ralenti:"+ralenti);
        //setParam( "CHECK_PERIOD", CHECK_PERIOD );
        //setParam( "SERVER_PORT", SERVER_PORT );
        //setParam( "DEBUG", DEBUG );
        //setParam( "LOG", LOG );
        switch (limite) {
            case "start" : OSCILLO[num-1].start = val; break;
            case "stop" :  OSCILLO[num-1].stop  = val; break;
        }
        OSCILLO[num-1].ralenti = ralenti;
        setParam( "OSCILLO", OSCILLO );
        //setParam( "ADJUST_STEP", ADJUST_STEP );
        jsonfile.writeFileSync(file, parameters);
        if (DEBUG) { console.log( jsonfile.readFileSync(file) ); }        
  
        //reinit les servo car les ralenti ont peut-être changes
        clearInterval(myServo[0]);
        clearInterval(myServo[1]);
        clearInterval(myServo[2]);
        clearInterval(myServo[3]);
        myServo[0] = setInterval(function() { moveServo(1) }, OSCILLO[0].ralenti); //servo 1 = OSCILLO[0]
        myServo[1] = setInterval(function() { moveServo(2) }, OSCILLO[1].ralenti);
        myServo[2] = setInterval(function() { moveServo(3) }, OSCILLO[2].ralenti);
        myServo[3] = setInterval(function() { moveServo(4) }, OSCILLO[3].ralenti);  
    });    

});

//End main program
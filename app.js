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
var ON  = 1;
var OFF = 0;
var STATE = ON;                                 // running mode
var MAX_PWM = 16;                               // max PWM on servoPi: Blue=>Pin1-Pin8 / White=>Pin=9-Pin16
var MAX_LED = MAX_PWM/2;                        // 2 Chanel (blue/white) / CoralCare

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


/*** TIME PERIOD & PWM ***/

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

//PWM Canal Led
function setPwmLed(pwm, num, brightness) {
    //if (DEBUG) { console.log('setPwmLed(pwm, num:'+num+' ,brightness:'+brightness+')'); }
    pwm_bright = Math.round(4095 - brightness * 4095 / 100);    //inverse for LDD SureElectronic
    pwm.setPWM(num, 0, pwm_bright);                             //pin 1-16)
    if (DEBUG) { console.log(num+'-auto) brightness='+brightness+'% pwm='+pwm_bright); }
}

//Build graph
function buildGraph() {
    var pwmW = {}
    var pwmB = {}
    var ratio;
    for (var i=0; i<=24; i++) {
        if (i<10) { hour = "0" + i +":00" }
        else { hour = i +":00" }
        ratio = getPwm(hour);
        pwmW[i] = ratio.white;
        pwmB[i] = ratio.blue;
    }
    console.log("White"+pwmW);
    console.log("Blue"+pwmB);
}

/*** Envoi infos page web ***/
var loop = setInterval(dimmingAuto, CHECK_PERIOD * 1000);
function dimmingAuto() {
    var now = new Date();
    var now_hour = dateFormat(now, "HH:MM");
    var ratio = getPwm( now_hour );             //check Time Period Ratio
    var tp = getTP( now_hour );                 //check Time Period
    if (DEBUG) { console.log('Ratio wanted',ratio); }

    //setPwmLed(pwm, 1, ratio.blue);
    //setPwmLed(pwm, 2, ratio.white);
    for (var i=1; i<=MAX_LED; i++) {
        //set PWM of Blue
        setPwmLed(pwm, i, ratio.blue);
        //set PWM of White
        setPwmLed(pwm, i+MAX_LED, ratio.white);
    }

    var tp_hour = "("+tp.tp1.hour+"-"+tp.tp2.hour+")";
    var tp_infos = " [B:"+tp.tp1.blue +"%-"+tp.tp2.blue+"% W:"+tp.tp1.white +"%-"+tp.tp2.white+"%]";

    infos_obj = {
        ratio,
        tp_infos,
        tp_hour,
        now_hour
    };
    io.sockets.emit('coralcare', {infos:infos_obj} );
}

/*** Ecoute socket de page web */
io.sockets.on('connection', function (socket) {
    //debug
    buildGraph();
    socket.emit('message', 'Vous êtes bien connecté !');

    // Quand le serveur reçoit un signal de type "onoff" du client    
    socket.on('onoff', function (data) {
        STATE = data.state;
        //if (DEBUG) { console.log("Socket onoff state:"+STATE); }
        if (STATE == OFF) {
            if (LOG) { console.log("STOP loop"); }
            clearInterval(loop);
        } else { //OFF loop
            if (LOG) { console.log("START loop"); }
            loop = setInterval(dimmingAuto, CHECK_PERIOD * 1000);
        }
    }); 

    socket.on('chanelmove', function (data) {
        num = data.chanel;
        ratio = data.ratio;
        STATE = data.state;
        if (LOG) { console.log("Socket chanelmove num:"+num+" ratio:"+ratio+" STATE:"+STATE); }
        if (STATE == OFF) {
            if (LOG) { console.log("setPwmLed(pwm,"+num+","+ratio+")"); }
            setPwmLed(pwm, num, ratio);
        } else { //ON
            console.log("PB chanelmove STATE=ON !!!");
        }
    });

});

//End main program
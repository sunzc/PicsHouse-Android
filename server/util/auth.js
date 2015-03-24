var bcrypt = require("bcrypt")
    , SALT_WORK_FACTOR = 10
    , passport = require("passport")
    , BearerStrategy = require("passport-http-bearer").Strategy
    , LocalStrategy = require("passport-local").Strategy
    , jwt = require("jsonwebtoken")
    , JWT_SECRET = "sEcReT"
    , FBTokenStrategy = require("passport-facebook-token").Strategy
    , app_config = require("../config")
;


//passport
passport.use(
    new LocalStrategy(function(username, password, done) {
        require("../model/user").findOne({username : username}, function(err, user) {

            if(err) {
                return done(err);
            }

            if(user) {
                user.comparePassword(password, function(err, is_match) {
                    if(err) {
                        return done(err);
                    }

                    if(is_match) {
                        return done(null, user);
                    } else {
                        return done(null, false, {message : "invalid_password"});
                    }
                });
            } else {
                return done(null, false, {message : "invalid_username"});
            }

        });
    }));

passport.use(new BearerStrategy(function(token, done) {

        require("../model/user").findOne({token : token}, function(err, user) {
            if(err) {
                return done(err);
            }

            if(user) {
                return done(null, user);
            } else {
                return done(null, false, {message : "invalid_token"});
            }
        });
    })
);

passport.use(
    new FBTokenStrategy({
        clientID : app_config.FB_CLIENT_ID
        , clientSecret : app_config.FB_CLIENT_SECRET
    }
    , function(accessToken, refreshToken, profile, done) {
            var User = require("../model/user");
            //console.log(profile);
            User.findOne({"facebook.id" : profile.id}, function(err, user) {

                if(err) {
                    return done(err);
                }

                if(user) {
                    user.token = accessToken;
                } else {

                    var username = profile.username || profile.displayName.replace(" ", "_");
                    var password = profile.id + (new Date()).getTime();
                    var email = profile.emails[0].value || (username + "@" + profile.provider);
                    user = new User({
                        username : username
                        , password : password
                        , email : email
                        , token : accessToken
                        , facebook : {
                            id : profile.id
                            , first_name : profile.name.givenName
                            , last_name : profile.name.familyName
                        }
                    });


                }

                user.save(function(err, u) {
                    return done(null, u);
                });

            });
    }
));

//middleware
var router = require("express").Router();

router.use(passport.initialize());

router.all("/", function(req, res, next) {

    next();
});

//schema plugin
function userPlugin (schema, options) {
    /*
    schema.add({
        username : {type : String, required : true, index : {unique : true}}
        , password : {type : String, required : true}
        , token : {type : String, required : true, index : {unique : true}}
    });
    */

    //hash password
    schema.pre('save', function(next) {
        var user = this;

        // only hash the password if it has been modified (or is new)
        if (!user.isModified('password')) return next();

        // generate a salt
        bcrypt.genSalt(SALT_WORK_FACTOR, function(err, salt) {
            if (err) return next(err);

            // hash the password along with our new salt
            bcrypt.hash(user.password, salt, function(err, hash) {
                if (err) return next(err);

                // override the cleartext password with the hashed one
                user.password = hash;
                next();
            });
        });
    });

    schema.methods.comparePassword = function(candidatePassword, cb) {
        bcrypt.compare(candidatePassword, this.password, function(err, isMatch) {
            if (err) return cb(err);
            cb(null, isMatch);
        });
    };
}

//private
function _getJWTByUser(user) {
    var info = {
        username : user.username
        , password : user.password
        , today : (new Date()).getTime()
    };
    return jwt.sign(info, JWT_SECRET);
}

function _passportAuthWrapper(name, option) {
    return function(req, res, next) {
        (passport.authenticate(name, option, function (err, user, info) {
            if (err) {
                return next(err);
            }

            if(user) {
                req.user = user;
                return next(null, user);
            } else {
                res.status(401);
                if(info && info.message) {
                    res.send({"ecode": info.message});
                } else {
                    res.send({"ecode" : "unauthorized"});
                }
            }
        }))(req, res, next);
    }
}

//public
//User -> (err -> User -> void) -> void
function register(user, cb) {
    user.token = _getJWTByUser(user);
    user.save(function(err, u) {
        if(err) {
            return cb(err);
        } else {
            return cb(null, u);
        }
    });
}

//User -> (err -> User -> void) -> void
function login(user, cb) {

    var token = _getJWTByUser(user);
    user.token = token;
    user.save(function(err, u) {

        if(err) {
            return cb(err);
        } else {
            return cb(null, u);
        }
    });
}

function authLocal() {
    return _passportAuthWrapper("local", {session: false});
}

function authToken() {
    return _passportAuthWrapper("bearer", {session:false});
}

function authFB() {
    return _passportAuthWrapper("facebook-token", {session:false});
}

module.exports = {
    register : register
    , login : login
    , middleware : router
    , mongoose_user_plugin : userPlugin
    , authLocal : authLocal
    , authToken : authToken
    , authFB : authFB
};

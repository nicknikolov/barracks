const mutate = require('xtend/mutable')
const assert = require('assert')
const xtend = require('xtend')

const applyHook = require('./apply-hook')
const wrapHook = require('./wrap-hook')

module.exports = dispatcher

// initialize a new barracks instance
// obj -> obj
function dispatcher (hooks) {
  hooks = hooks || {}
  assert.equal(typeof hooks, 'object', 'barracks: hooks should be undefined or an object')

  const onStateChangeHooks = []
  const onActionHooks = []
  const onErrorHooks = []

  const subscriptionWraps = []
  const initialStateWraps = []
  const reducerWraps = []
  const effectWraps = []

  use(hooks)

  var reducersCalled = false
  var effectsCalled = false
  var stateCalled = false
  var subsCalled = false

  const subscriptions = start._subscriptions = {}
  const reducers = start._reducers = {}
  const effects = start._effects = {}
  const models = start._models = []
  var _state = {}

  start.model = setModel
  start.state = getState
  start.start = start
  start.use = use
  return start

  // push an object of hooks onto an array
  // obj -> null
  function use (hooks) {
    assert.equal(typeof hooks, 'object', 'barracks.use: hooks should be an object')
    assert.ok(!hooks.onError || typeof hooks.onError === 'function', 'barracks.use: onError should be undefined or a function')
    assert.ok(!hooks.onAction || typeof hooks.onAction === 'function', 'barracks.use: onAction should be undefined or a function')
    assert.ok(!hooks.onStateChange || typeof hooks.onStateChange === 'function', 'barracks.use: onStateChange should be undefined or a function')

    if (hooks.onError) onErrorHooks.push(wrapOnError(hooks.onError))
    if (hooks.onAction) onActionHooks.push(hooks.onAction)
    if (hooks.onStateChange) onStateChangeHooks.push(hooks.onStateChange)
    if (hooks.wrapSubscriptions) subscriptionWraps.push(hooks.wrapSubscriptions)
    if (hooks.wrapReducers) reducerWraps.push(hooks.wrapReducers)
    if (hooks.initialState) initialStateWraps.push(hooks.initialState)
    if (hooks.wrapEffects) effectWraps.push(hooks.wrapEffects)
  }

  // push a model to be initiated
  // obj -> null
  function setModel (model) {
    assert.equal(typeof model, 'object', 'barracks.store.model: model should be an object')
    models.push(model)
  }

  // get the current state from the store
  // obj? -> obj
  function getState (opts) {
    opts = opts || {}
    assert.equal(typeof opts, 'object', 'barracks.store.state: opts should be an object')
    if (opts.state) {
      const initialState = {}
      const nsState = {}
      models.forEach(function (model) {
        const ns = model.namespace
        const modelState = model.state || {}
        if (ns) {
          nsState[ns] = {}
          apply(ns, modelState, nsState)
          nsState[ns] = xtend(nsState[ns], opts.state[ns])
        } else {
          apply(model.namespace, modelState, initialState)
        }
      })
      return xtend(_state, xtend(opts.state, nsState))
    } else if (opts.freeze === false) {
      return xtend(_state)
    } else {
      return Object.freeze(xtend(_state))
    }
  }

  // initialize the store hooks, get the send() function
  // obj? -> fn
  function start (opts) {
    opts = opts || {}
    assert.equal(typeof opts, 'object', 'barracks.store.start: opts should be undefined or an object')

    // register values from the models
    models.forEach(function (model) {
      const ns = model.namespace
      if (!stateCalled && model.state && opts.state !== false) {
        apply(ns, model.state, _state, function (cb) {
          return wrapHook(cb, initialStateWraps)
        })
      }
      if (!reducersCalled && model.reducers && opts.reducers !== false) {
        apply(ns, model.reducers, reducers, function (cb) {
          return wrapHook(cb, reducerWraps)
        })
      }
      if (!effectsCalled && model.effects && opts.effects !== false) {
        apply(ns, model.effects, effects, function (cb) {
          return wrapHook(cb, effectWraps)
        })
      }
      if (!subsCalled && model.subscriptions && opts.subscriptions !== false) {
        apply(ns, model.subscriptions, subscriptions, function (cb, key) {
          const send = createSend('subscription: ' + (ns ? ns + ':' + key : key))
          cb = wrapHook(cb, subscriptionWraps)
          cb(send, function (err) {
            applyHook(onErrorHooks, err)
          })
          return cb
        })
      }
    })

    if (!opts.noState) stateCalled = true
    if (!opts.noReducers) reducersCalled = true
    if (!opts.noEffects) effectsCalled = true
    if (!opts.noSubscriptions) subsCalled = true

    if (!onErrorHooks.length) onErrorHooks.push(wrapOnError(defaultOnError))

    return createSend

    // call an action from a view
    // (str, bool?) -> (str, any?, fn?) -> null
    function createSend (selfName, callOnError) {
      assert.equal(typeof selfName, 'string', 'barracks.store.start.createSend: selfName should be a string')
      assert.ok(!callOnError || typeof callOnError === 'boolean', 'barracks.store.start.send: callOnError should be undefined or a boolean')

      return function send (name, data, cb) {
        if (!cb && !callOnError) {
          cb = data
          data = null
        }
        data = (typeof data === 'undefined' ? null : data)

        assert.equal(typeof name, 'string', 'barracks.store.start.send: name should be a string')
        assert.ok(!cb || typeof cb === 'function', 'barracks.store.start.send: cb should be a function')

        const done = callOnError ? onErrorCallback : cb
        _send(name, data, selfName, done)

        function onErrorCallback (err) {
          err = err || null
          if (err) {
            applyHook(onErrorHooks, err, _state, function createSend (selfName) {
              return function send (name, data) {
                assert.equal(typeof name, 'string', 'barracks.store.start.send: name should be a string')
                data = (typeof data === 'undefined' ? null : data)
                _send(name, data, selfName, done)
              }
            })
          }
        }
      }
    }

    // call an action
    // (str, str, any, fn) -> null
    function _send (name, data, caller, cb) {
      assert.equal(typeof name, 'string', 'barracks._send: name should be a string')
      assert.equal(typeof caller, 'string', 'barracks._send: caller should be a string')
      assert.equal(typeof cb, 'function', 'barracks._send: cb should be a function')

      setTimeout(function () {
        var reducersCalled = false
        var effectsCalled = false
        const newState = xtend(_state)

        if (onActionHooks.length) {
          applyHook(onActionHooks, data, _state, name, caller, createSend)
        }

        // validate if a namespace exists. Namespaces are delimited by ':'.
        var actionName = name
        if (/:/.test(name)) {
          const arr = name.split(':')
          var ns = arr.shift()
          actionName = arr.join(':')
        }

        const _reducers = ns ? reducers[ns] : reducers
        if (_reducers && _reducers[actionName]) {
          if (ns) {
            const reducedState = _reducers[actionName](data, _state[ns])
            newState[ns] = xtend(_state[ns], reducedState)
          } else {
            mutate(newState, reducers[actionName](data, _state))
          }
          reducersCalled = true
          if (onStateChangeHooks.length) {
            applyHook(onStateChangeHooks, data, newState, _state, actionName, createSend)
          }
          _state = newState
          cb()
        }

        const _effects = ns ? effects[ns] : effects
        if (!reducersCalled && _effects && _effects[actionName]) {
          const send = createSend('effect: ' + name)
          if (ns) _effects[actionName](data, _state[ns], send, cb)
          else _effects[actionName](data, _state, send, cb)
          effectsCalled = true
        }

        if (!reducersCalled && !effectsCalled) {
          throw new Error('Could not find action ' + actionName)
        }
      }, 0)
    }
  }
}

// compose an object conditionally
// optionally contains a namespace
// which is used to nest properties.
// (str, obj, obj, fn?) -> null
function apply (ns, source, target, wrap) {
  if (ns && !target[ns]) target[ns] = {}
  Object.keys(source).forEach(function (key) {
    const cb = wrap ? wrap(source[key], key) : source[key]
    if (ns) target[ns][key] = cb
    else target[key] = cb
  })
}

// handle errors all the way at the top of the trace
// err? -> null
function defaultOnError (err) {
  throw err
}

function wrapOnError (onError) {
  return function onErrorWrap (err) {
    if (err) onError(err)
  }
}

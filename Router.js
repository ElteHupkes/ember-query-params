/**
 * Router additions to work with query parameters in
 * Ember.js.
 *
 * https://github.com/ElteHupkes/ember-query-params
 *
 * @author Elte Hupkes
 */
(function() {
	var merge = Ember.merge, keys = Ember.keys,
		slice = Array.prototype.slice;

	Ember.Router.reopen({
		/**
		 * The current query string.
		 */
		queryString: '',

		/**
		 * Calculates query parameters from the query string.
		 */
		queryParameters: function(k, params) {
			if (arguments.length === 2) {
				// Setter, serialize and set query string
				this.set('queryString', serialize(params));
				return params;
			}

			// Getter
			return deserialize(this.get('queryString'));
		}.property('queryString'),

		/**
		 * Overrides handleURL to process the query string in a
		 * URL.
		 */
		handleURL: function(url) {
			var parts = url.split('?', 2),
				oldInfos = generateOldInfos(this.router),
				that = this;

			// Update the query string and query parameters
			this.set('queryString', parts.length < 2 ? '' : parts[1]);
			return this._super(parts[0]).then(function() {
				// When the transition has completed,
				// we're going to check which routes
				// are left with "dirty" contents due
				// to changed query parameters. We're
				// then going to trampoline in order
				// to update these routes.
				that.updateParameterContexts(oldInfos);
			});
		},

		/**
		 * Wrapper over transitionTo that updates parameter contexts.
		 * You can supply an Ember.Router.QueryParameters object as
		 * the second argument (so the first context) to have it
		 * processed.
		 */
		transitionTo: function(handlerName) {
			var parts = queryPartition(this.router, handlerName, slice.call(arguments, 1)),
				oldInfos = generateOldInfos(this.router);

			this.set('queryParameters', parts.queryParams);

			var transition = this._super.apply(this, parts.args),
				that = this;

			transition.promise.then(function() {
				// Update routes that weren't refreshed with their
				// new query parameters
				that.updateParameterContexts(oldInfos);

				// The router uses the recognizer to generate
				// the URL in finalizeTransition; so that clears
				// any query string parameters that might have been set.
				// Overriding this method is more complicated and would
				// probably have other side-effects, so instead I just
				// update the URL here with the latest query string parameters.
				var url = that.location.getURL().split('?', 1)[0],
					qs = that.get('queryString');

				if (qs) {
					url += '?'+qs;
				}

				that.location.setURL(url);
			});

			return transition;
		},

		generate: function(handlerName) {
			var parts = queryPartition(this.router, handlerName, slice.call(arguments, 1)),
				url = this._super.apply(this, parts.args),
				queryString = serialize(parts.queryParams);

			if (queryString) {
				url += '?'+queryString;
			}

			return url;
		},

		/**
		 * In order to force the transition's match point, we're going
		 * to jump to the parent of the highest-level dirty route.
		 *
		 * @param oldInfos {Array}
		 */
		updateParameterContexts: function(oldInfos) {
			var currentInfos = this.router.currentHandlerInfos;

			for (var i = 0, l = currentInfos.length; i < l; i++) {
				var handlerObj = currentInfos[i],
					handler = handlerObj.handler,
					oldObj = oldInfos[i],
					observes = handler.observesParameters,
					hasParameters = observes && (observes === true || Ember.isArray(observes));

				if (!hasParameters || !handler.modelWithQuery) {
					// Don't care about handlers without parameters
					// or handlers we cannot update anyway.
					continue;
				}

				// Create parameter set for this handler
				var handlerParams = handler.get('queryParameters');

				// Check if we were previously in this state - if not
				// we can assume model() was called and the query params
				// are assumed up to date.
				if (!oldObj || oldObj.name !== handlerObj.name ||
					oldObj.context !== handler.context) {
					handler.currentQueryParams = handlerParams;
					continue;
				}

				if (parametersDiffer(handler.currentQueryParams, handlerParams)) {
					// Update query parameters by calling modelWithQuery
					// In line with the new router changes I'll allow this
					// to return a promise, which is why we need these obnoxious
					// inner closures ;).
					var resolveFunc = (function() {
							var han = handler;

							return function() {
								return han.modelWithQuery();
							};
						})(),
						updateFunc = (function() {
							var controller = handler.controllerFor(handler.routeName),
								han = handler;

							return function(context) {
								// This mimics the internal setContext() method.
								han.context = context;
								if (han.contextDidChange) { han.contextDidChange(); }

								// Call setupController
								han.setupController(controller, context);
							};
						})();

					handler.currentQueryParams = handlerParams;
					Ember.RSVP.resolve()
						.then(resolveFunc)
						.then(updateFunc);
				}
			}
		}
	});

	// Marker object for query parameters in transition.
	Ember.Router.QueryParameters = Ember.Object.extend();

	/**
	 * Reopen Route to gain up to date
	 * route-specific query params.
	 */
	Ember.Route.reopen({
		/**
		 * Computed property that extracts this route's
		 * relevant parameters.
		 */
		queryParameters: function() {
			return extract(this.get('router.queryParameters'),
				this.get('observesParameters'));
		}.property('router.queryParameters'),

		/**
		 * The modelWithQuery method is called when the query
		 * parameters for this route have changed and should
		 * return the model updated with the latest params.
		 */
		modelWithQuery: function() {
			return this.model.apply(this, arguments);
		}
	});

	/**
	 * Simple one-dimensional object comparison for
	 * parameter objects.
	 * @param a
	 * @param b
	 * @returns {boolean}
	 */
	var parametersDiffer = function(a, b) {
		var k = keys(a);

		if (k.length != keys(b).length) {
			return true;
		}

		for (var i = 0, l = k.length; i < l; i++) {
			if (a[k[i]] !== b[k[i]]) {
				return true;
			}
		}

		return false;
	};

	/**
	 * One-level object copy, extracting only the
	 * relevant parameters.
	 * @param obj
	 * @param params {Boolean|Array} A route's "observesParameters" setting.
	 * @returns {{}}
	 */
	var extract = function(obj, params) {
		var r = {};
		params = params || [];

		if (typeof params === "boolean") {
			return params ? r : merge(r, obj);
		}

		params.forEach(function(param) {
			if (param in obj) {
				r[param] = obj[param];
			}
		});
		return r;
	};

	/**
	 * Serializes the parameter object.
	 * @param params {}
	 * @returns {String}
	 */
	var serialize = function(params) {
		var arr = [];
		for (var k in params) {
			if (!params.hasOwnProperty(k) || !params[k]) {
				// Ignore falsy values
				continue;
			}

			// Need to encode the keys and values
			// just in case they contain "=", "&" or "?".
			// If they're added to something like HashLocation
			// they'll probably be encoded again by the browser,
			// which will make them look mildly hideous, but
			// so be it..
			var key = encodeURIComponent(k);
			if (params[k] === true) {
				// Flag value
				arr.push(key);
			} else {
				// Simple key/value pair
				arr.push(key+'='+encodeURIComponent(params[k]));
			}
			arr.push();
		}
		return arr.join('&');
	};

	/**
	 * Deserializes a query string into
	 * a key => value object.
	 * @param queryString
	 * @returns {{}}
	 */
	var deserialize = function(queryString) {
		// Getter, unserialize query string
		var pairs = queryString.split('&'),
			params = {};

		pairs.forEach(function(pair) {
			if (!pair) { return; }
			var kv = pair.split('=', 2), key, value;
			if (kv.length < 2) {
				// Key without value is considered flag
				value = true;
			} else {
				value = decodeURIComponent(kv[1]);
			}

			key = decodeURIComponent(kv[0]);
			params[key] = value;
		});

		return params;
	};


	/**
	 * Returns the query parameters and actual contexts given
	 * a handler name and list of contexts (the arguments to
	 * transitionTo and generate). Returns an object with two
	 * properties:
	 * - queryParams: The query params object for the given arguments
	 * - contexts: The contexts argument minus an eventual QueryParameters object.
	 * - args: The full argument array for generate / transitionTo
	 * 			(handler name and contexts without query params).
	 */
	var queryPartition = function(router, handlerName, contexts) {
		var queryParams = {},
			currentHandlerInfos = router.currentHandlerInfos,
			overrideParams, handlers,
			matchPoint;

		// Detect a QueryParameters object and shift it off the parameters array
		if (contexts[0] && contexts[0] instanceof Ember.Router.QueryParameters) {
			var paramsObject = contexts.shift();
			overrideParams = paramsObject.getProperties(keys(paramsObject));
		}

		// Get the query parameters that should be maintained
		if (!router.hasRoute(handlerName)) {
			handlerName += '.index';
		}

		handlers = router.recognizer.handlersFor(handlerName);
		matchPoint = getMatchPoint(router, handlers, contexts);

		for (var i = 0, l = currentHandlerInfos.length; i < l, i < matchPoint; i++) {
			var handlerObj = currentHandlerInfos[i],
				handler = handlerObj.handler;

			// Merge with existing query params
			if (handler.currentQueryParams) {
				merge(queryParams, handler.currentQueryParams);
			}
		}

		if (overrideParams) {
			// Merge the query object parameters into
			// the params.
			merge(queryParams, overrideParams);
		}

		// Clean out any value that is falsy
		keys(queryParams).forEach(function(key) {
			if (!queryParams[key]) {
				delete queryParams[key];
			}
		});

		return {
			contexts: contexts,
			queryParams: queryParams,
			args: [handlerName].concat(contexts)
		};
	};

	// Generates the list of info objects that is used to check
	// changes over transitions
	var generateOldInfos = function(router) {
		var infos = [],
			currentInfos = router.currentHandlerInfos || [];

		for (var i = 0, l = currentInfos.length; i < l; i++) {
			var infoObj = currentInfos[i];
			infos.push({
				name: infoObj.name,
				context: infoObj.handler.context
			});
		}

		return infos;
	};

	// In order to determine the parameters to maintain in
	// queryPartition, we really need to know the match
	// point. Therefore I define a simplified getMatchPoint
	// below that calculates it.
	// TODO use active transition information
	var getMatchPoint = function (router, handlers, objects) {
		var matchPoint = handlers.length, i,
			currentHandlerInfos = router.currentHandlerInfos || [],
			nrObjects = objects.length;

		for (i = handlers.length - 1; i >= 0; i--) {
			var handlerObj = handlers[i],
				handlerName = handlerObj.handler,
				oldHandlerInfo = currentHandlerInfos[i],
				hasChanged = false;

			if (!oldHandlerInfo || oldHandlerInfo.name !== handlerName) {
				hasChanged = true;
			}

			if ((handlerObj.isDynamic || (handlerObj.names && handlerObj.names.length)) && nrObjects) {
				nrObjects--;
				hasChanged = true;
			}

			if (hasChanged) {
				matchPoint = i;
			}
		}

		return matchPoint;
	};


})();

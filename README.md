# Query string parameters for Ember.js

Query parameters are something I have been missing in Ember.js
pretty much from the moment I started using it. There is
[an open issue for it](https://github.com/emberjs/ember.js/issues/1773)
where several workarounds have been offered, but nothing
has really served me properly thusfar. I therefore took a
close look at the router to see if I couldn't implement something
that didn't compromise on too many points.

# Features
- Location API independent - it doesn't matter if you use `HashLocation` or `HistoryLocation`.
- Global query parameters (I'd prefer local ones, but this really does not
  seem possible without modifying the internal `RouteRecogizer`). The syntax
  is what you know from the web: "/url/to/something?key=value&key2=value2"
- Updates only route context's whose parameters change.
- Very little configuration - only requires an `observesParameters` property
  in your route handlers (see "How to use").
- Automatically maintains parent query parameters when traversing to child routes.
- Query parameters can be updated with an `Ember.Router.QueryParameter` object
  through existing `transitionTo` methods.
- Works with URL generation / links.

# Known issues and limitation
I just finished this.. so no real issues at the moment ;).

Parameter serialization / deserialization is pretty limited
a this point - honestly I built this for myself and I only
require plain key / value params. You can always do some
more processing after you retrieve the parameters though.

# How to use
## File setup
Just include the supplied `Router.js` file somewhere in your project.

## Route configuration
The most simple setup to work with query parameters
looks something like this:

```js
	App.PostsRoute = Ember.Route.extend({
		observesParameters: ['sort', 'search'],
		model: function() {
			return App.Post.find(this.get('queryParameters'));
		}
	});
```

The full configuration options are:

- An `observesParameters` property. This is either a
  boolean or an array, where a boolean `true` indicates
  all possible parameters are observed, whereas an array would
  specify exactly which parameters are observed.
- An optional `modelWithQuery()` method, returns the
  model based on the most recent query parameters.
  I've chosen for this approach because it's not possible
  for this implementation to respect `model()`'s method
  signature (there's no transition when it is called).
  I've found that in most cases these methods will be
  identical though - so by default `modelWithQuery`
  simply aliases `model`. If you don't do anything fancy
  in `model` (like redirecting or checking the transition)
  there's no need to implement `modelWithQuery`. Like
  `model`, `modelWithQuery` can return a promise.

## Changing parameters
Because `transitionTo` is included in three places (router, route, controller)
I wanted to avoid having to create a different `transitionToWithQuery`
everywhere. I therefore introduced the Ember.Router.QueryParameters object,
an instance of which can passed as the first context to `transitionTo`,
containing key/value pairs of the query parameters you want to update. This
also means automatic compatibility with the `linkTo` helper and the `LinkView`.
When transitioning to a child route, parent query string parameters are maintained
by default. To remove a parameter, pass a "falsy" value (null/undefined/false)
in the QueryParameters object.

# How it works
The main problem this implementation is solving is updating contexts of routes
that weren't updated by the Ember router because they were already active
at the time of the transition.  When the app is loaded
`handleURL` is called with the initial URL, determining the
initial state of the application. From this initial state,
transitions can be made either by URL-changes or transitions.
This implementation hooks into both `handleURL` and `transitionTo`, chaining
a callback to the end of their transitions' promises. This callback loops
over the list of handlers active after the transition, for each handler checking:

- Was it also active before the last transition?
- Does it listen to parameters?
- Did its parameters change, while its context remained the same?

If all of these questions can be answered with "yes", the `modelWithQuery`
method is called for the route, followed by `setupController` to actually
update its values.

Another important feature is maintaining query parameters of active routes
throughout transitions. Say you have a route setup of "posts" and "posts.view",
and you're currently in a URL state like "/posts?sort=date". Assuming the
"posts" route holds the list of posts (and not the "posts.index" route),
when moving to a specific post you do not want the sort of the "posts" route
to change. In other words, you want to transition to "/posts/10?sort=date"
to maintain the sorting order of the "posts" route while viewing a specific
post. This implementation solves this problem by finding a match point
for transitions (something Ember also does internally when determining
which route handlers to update) and merging all parameters below this
match point with the new request.

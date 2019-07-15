# PubCap

PubCap is designed to capture messages published to Google Pub/Sub topics.

## Install and Setup

Install the component as development dependency:

```
npm i @sixriver/pubcap -D
```


## Usage

Bellow is the typical setup for Mocha framework.

Setup *before/after* hooks to register topics being listened and the code to cleanup the mess after the tests are over:

```javascript

const pubcap = new PubCap({

});

before(async function() {
	await pubcap.listen(pubsub, ['topic1', 'topic2']);
});

after(async function() {
	await pubcap.close();
});

```

Optionally setup *beforeEach* or *afterEach* hook to drain messages from the registered topics:

```javascript
beforeEach(async function() {
	await pubcap.drain();
})
```

Access captured messages using `PubCap#messages` method:

```javascript
it('should capture messages', async function() {
	const myMessages = await pubcap.messages('my-topic');
	// ...
});
```

See test/pubcap.spec.ts as an example.

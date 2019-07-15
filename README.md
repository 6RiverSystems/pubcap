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

## Getting Raw Pub/Sub messages

Method *PubCap#messages* by default returns the result of `JSON.parse(msg.data.toString())`. Use *Raw* decoder to get raw Pub/Sub messages:

```javascript
import {PubCap, RAW} from '@6river/pubcap';

const pubcap = new PubCap();
// ...
const messages = await pubcap.messages('my-topic', {decoder: RAW});
```

## Writing your own message decoder

Implement the *Decoder* interface to get raw messages converted some custom (or typesafe) way.

```javascript

import {Message} from '@google-cloud/pubsub';
import {Decoder, PubCap} from '@6river/pubcap';

// Suppose we have some message type
interface FooMessage {
	id: string;
	foo: boolean;
}

// Here is our decoder
class FooDecoder implements Decoder<FooMessage> {
	decode(msg: Message): FooMessage {
		const foo: FooMessage = ...
		return foo;
	}
}


// now make the decoder and use it
const decoder = new FooDecoder();
const messages = await pubcap.messages('my-topic', {decoder});

```

## Se also

*test/pubcap.spec.ts* as an example.

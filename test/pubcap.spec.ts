import {PubSub, Topic} from '@google-cloud/pubsub';
import {should, assert} from 'chai';
import {PubCap} from '../src/pubcap';

should();

describe('PubCap', function() {
	const PUBSUB_PROJECT_ID = 'pubcap-test';
	const FAST_PUB_TOPIC = 'fast-topic';
	const SLOW_PUB_TOPIC = 'slow-topic';
	const FAST_BATCHING_TIMEOUT = 10;
	const SLOW_BATCHING_TIMEOUT = 200;

	let pubcap: PubCap;
	let pubsub: PubSub;
	let fastToPublishTopic: Topic;
	let slowToPublishTopic: Topic;

	function fullSubscriptionName(topicName: string) {
		return `projects/${PUBSUB_PROJECT_ID}/subscriptions/${topicName}`;
	}

	before(async () => {
		pubsub = new PubSub({projectId: PUBSUB_PROJECT_ID});

		// have to include batching options when getting topic, setPublishOptions can't change it,
		// see https://github.com/googleapis/nodejs-pubsub/issues/1103
		fastToPublishTopic = pubsub.topic(FAST_PUB_TOPIC, {batching: {maxMilliseconds: FAST_BATCHING_TIMEOUT}});
		// create a second topic and set it up to wait long to publish messages
		slowToPublishTopic = pubsub.topic(SLOW_PUB_TOPIC, {batching: {maxMilliseconds: SLOW_BATCHING_TIMEOUT}});
		// the return from `.get` won't preserve our batching options, and the issue above means we can't re-set them
		await Promise.all([fastToPublishTopic, slowToPublishTopic].map((t) => t.get({autoCreate: true})));

		pubcap = new PubCap({
			messagesTimeout: 100,
			drainTimeout: 200,
		});

		// you can use topic instance directly or reference it by name
		await pubcap.listen(pubsub, [fastToPublishTopic, SLOW_PUB_TOPIC]);
	});

	after(async () => {
		await pubcap.close();
		await fastToPublishTopic.delete();
		await slowToPublishTopic.delete();
	});

	beforeEach(async () => {
		await pubcap.drain();
		assert.strictEqual(fastToPublishTopic.publisher.queue.batchOptions.maxMilliseconds, FAST_BATCHING_TIMEOUT);
		assert.strictEqual(slowToPublishTopic.publisher.queue.batchOptions.maxMilliseconds, SLOW_BATCHING_TIMEOUT);
	});

	context('setup', function() {
		it('should create pubtub subscriptions', async function() {
			const [subs1] = await fastToPublishTopic.getSubscriptions();
			subs1.length.should.equal(1);
			subs1[0].name.should.equal(fullSubscriptionName(`${FAST_PUB_TOPIC}-pubcap`));

			const [subs2] = await slowToPublishTopic.getSubscriptions();
			subs2.length.should.equal(1);
			subs2[0].name.should.equal(fullSubscriptionName(`${SLOW_PUB_TOPIC}-pubcap`));
		});
	});

	context('get messages', function() {
		it('should catch published messages', async function() {
			const COUNT = 100;
			for (let i = 0; i < COUNT; i++) {
				fastToPublishTopic.publishJSON({i});
			}
			const messages: {i: number}[] = await pubcap.messages(fastToPublishTopic);
			messages.length.should.equal(COUNT);
			messages[0].should.deep.equal({i: 0});
			messages[1].should.deep.equal({i: 1});
		});
	});

	context('drain messages', function() {
		it('should wait for messages and then reset message channels', async function() {
			fastToPublishTopic.publishJSON({foo: 'bar', now: (new Date()).getTime()});
			await pubcap.drain();

			const messages = await pubcap.messages(fastToPublishTopic);
			messages.length.should.equal(0);
		});


		it('should not clear messages arrived after draining is finished', async function() {
			slowToPublishTopic.publishJSON({foo: 'bar', now: (new Date()).getTime()});
			await pubcap.drain({timeout: SLOW_BATCHING_TIMEOUT / 2});
			const messages = await pubcap.messages(slowToPublishTopic, {timeout: SLOW_BATCHING_TIMEOUT * 2});
			messages.length.should.equal(1);
		});
	});
});

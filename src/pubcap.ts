import {PubSub, Message, Topic} from '@google-cloud/pubsub';
import {PreciseDate} from '@google-cloud/precise-date';
import {basename} from 'path';

// Decoder defines pubsub.Message decodeing interface.
export interface Decoder<T> {
	decode(msg: Message): T;
}

// RawDecoder decodes nothing. It just returns raw pubsub message as is.
class RawDecoder implements Decoder<Message> {
	decode(msg: Message): Message {
		return msg;
	}
}

// RAW in instance of RawDecoder.
export const RAW = new RawDecoder();

// JSONDecoder decodes msg.data buffer with JSON.parse.
export class JSONDecoder<T = any> implements Decoder<T> {
	decode(msg: Message): T {
		return JSON.parse(msg.data.toString()) as T;
	}
}

// promisified setTimeout
function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function unixTime(time: Date): number {
	return time.getTime()/1000|0;
}

type CancelFunc = () => Promise<void>;

type TopicOrName = Topic | string;

function isTopic(value: TopicOrName): value is Topic {
	return value instanceof Topic;
}

function intoTopicName(value: TopicOrName): string {
	if (isTopic(value)) {
		return basename(value.name);
	} else {
		return value;
	}
}

async function intoTopic(value: TopicOrName, pubsub: PubSub): Promise<Topic> {
	if (isTopic(value)) {
		return value;
	}

	const [topic] = await pubsub.topic(value).get({autoCreate: true});
	return topic;
}

export interface Config {
	messagesTimeout: number,
	drainTimeout: number,
	closeTimeout: number,
};

const defaults: Config = {
	messagesTimeout: 200,
	drainTimeout: 200,
	closeTimeout: 500,
};

// PubCap is designed to collect messages sent to specified topics.
//
// const pubcap = new PubCap(pubsub, ['topic-1', 'topic-2', 'topic-3']);
// await pubcap.start();
// ...
// const msgSet1 = await pubcap.messages('topic-1');
// ....
// pubcap.reset();
// ...
// const msgSet2 = await pubcap.messages('topic-1');
// ...
//
// await pubcap.stop();
//
// See */test* directory for usage examples.
export class PubCap {
	private channels: Map<string, Message[]>;
	private subCancels: CancelFunc[];
	private resetTime: Date;
	private opts: Config;

	constructor(config: Partial<Config> = {}) {
		this.opts = Object.assign({}, defaults, config);
		this.resetTime = new Date();
		this.subCancels = [];
		this.channels = new Map();
	}

	// waits for messages to arrive and then resets all the channels
	async drain({timeout = this.opts.drainTimeout}: {timeout?: number} = {}) {
		await sleep(timeout);
		this.resetTime = new Date();
		this.channels.forEach((chan) => chan.length = 0);
	}

	// messages returns accumulated array of messages published to the given topic.
	//
	// Options:
	// * timeout - milliseconds to wait for messages being collected.
	// * decoder - decoder to use to convert raw pubsub.Message into type T (default is JSON.parse of msg.data buffer).
	//
	// Usage examples:
	// const msgs = await pubcap.messages('my-topic');
	// const msgs = await pubcap.messages('my-topic', {timeout: 100});
	//
	// Without decoder. Getting array of raw pubsub.Message(s)
	//
	// const msgs = await pubcap.messages('my-topic', {decoder: RAW});
	//
	// With custom decoder:
	//
	// interface Foo {
	//   bar: string;
	//   baz: boolean;
	// };
	//
	// class FooDecoder implements Decoder<Foo> {
	//   constructor() {...}
	//	 parse(msg: Message): Foo { ... }
	//	 decode(msg: Message): Foo {
	//		 return this.parse(msg);
	//	 }
	// };
	//
	// const msgs = await pubcap.messages('my-topic', {decoder: new FooDecoder()});
	// assert(msgs[0].baz);
	//
	async messages<T, D extends Decoder<T>>(
		topic: TopicOrName,
		{
			timeout = this.opts.messagesTimeout,
			decoder = new JSONDecoder<T>(), // parse msg.data buffer with JSON.parse
		}: {
			timeout?: number, // timeout in milliseconds to wait for messages
			decoder?: D | JSONDecoder<T> // decoder to convert Message to T
		} = {}
	): Promise<T[]> {
		// give the capture some time to receive the messages
		await sleep(timeout);

		const messages = this.channels.get(intoTopicName(topic)) || [];
		return messages.map((msg) => decoder.decode(msg));
	}

	private isAfterReset(t: PreciseDate): boolean {
		return unixTime(t) >= unixTime(this.resetTime);
	}

	// wiretap makes a temporal subscription to track all the messages published to the given topic.
	private async wiretap(pubsub: PubSub, topicOrName: TopicOrName): Promise<CancelFunc> {
		const topicName = intoTopicName(topicOrName);
		const topic = await intoTopic(topicOrName, pubsub);
		const subscriptionName = `${topicName}-pubcap`;
		const [sub] = await topic.subscription(subscriptionName).get({autoCreate: true});

		const chan: Message[] = [];
		this.channels.set(topicName, chan);

		const listener = (msg: Message) => {
			// ignore all the messages received after reset
			if (this.isAfterReset(msg.publishTime)) {
				chan.push(msg);
			}
			msg.ack();
		};

		sub.on('message', listener);

		const cancel = async () => {
			await sub.close();
			sub.removeListener('message', listener);
			await sub.delete();
		};

		return cancel;
	}

	// start the capture. On start the capture wiretaps the specified topics by
	// creating a number of temporal subscriptions.
	async listen(pubsub: PubSub, topics: TopicOrName[]) {
		await this.close(); // close and clear previously
		this.subCancels = await Promise.all(topics.map((topic) => this.wiretap(pubsub, topic)));
	}

	// stop removes all the temporal subscriptions
	async close({timeout = this.opts.closeTimeout}: {timeout?: number} = {}) {
		// cancel all subscriptions
		await Promise.all(this.subCancels.map((cancel) => cancel()));
		this.subCancels = [];

		// it seems the subscription delete is not fully async.
		// 0 timeout produces uncaught exception on grpc client about Topic does not exist in case
		// the topic bound to subscription is removed right after `close` is called.
		// To overcome it 500 ms timeout is added.
		await sleep(timeout);
	}
}

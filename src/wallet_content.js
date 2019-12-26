import {EncryptedStream, LocalStream} from 'extension-streams';
import IdGenerator from '@walletpack/core/util/IdGenerator'
import {apis} from './util/browserapis';

let stream = new WeakMap();

let isReady = false;
class Content {

	constructor(){
		this.setupEncryptedStream();
		this.injectInteractionScript();
	}


	setupEncryptedStream(){
		stream = new EncryptedStream('scatter', IdGenerator.text(256));
		stream.listenWith((msg) => this.contentListener(msg));
		stream.onSync(async () => isReady = true);
	}

	async injectInteractionScript(){
		if(location.href.indexOf('#/popout') === -1) {
			const bg_port = chrome.runtime.connect({name: "wallet"});
			bg_port.onMessage.addListener(async (msg, sender, respond) => {
				stream.send({type: 'socket', payload: msg}, 'injected')
			});
		}


		// TODO: This won't actually do what it's supposed to
		// since the servers will push back files from a different place each time,

		// LocalStream.send({type:'embedder'}).then(verified => {
		// 	if(!verified) return;

			let script = document.createElement('script');
			script.src = chrome.extension.getURL('wallet_inject.js');
			(document.head||document.documentElement).appendChild(script);
			script.onload = () => script.remove();
		// })

	}

	contentListener(msg){
		if(!isReady || !stream.synced || (msg.hasOwnProperty('type') && msg.type === 'sync')) return this.sync(msg);
		LocalStream.send(msg).then(result => stream.send({id:msg.id, result}, 'injected'));
	}

	sync(message){
		stream.key = message.handshake.length ? message.handshake : null;
		stream.send({type:'sync'}, 'injected');
		stream.synced = true;
	}

}

new Content();

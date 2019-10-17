const {LocalStream} = require('extension-streams');
const apis = require('./util/browserapis');
const wallet = require('./services/wallet');
const storage = require('./services/storage');
const files = require('./services/files');
const embedder = require('./services/embedder');
const windows = require('./services/windows');
const PseudoSockets = require('./services/sockets');

const Scatter = require('@walletpack/core/models/Scatter').default;
const ApiService = require('@walletpack/core/services/apis/ApiService').default;
const IdGenerator = require('@walletpack/core/util/IdGenerator').default;
const StoreService = require('@walletpack/core/services/utility/StoreService').default;
const EventService = require('@walletpack/core/services/utility/EventService').default;
const AppsService = require('@walletpack/core/services/apps/AppsService').default;
const WalletPack = require('@walletpack/core').default;

wallet.setStorage(storage);
wallet.init();

let openTab = null;
chrome.browserAction.onClicked.addListener(function(tab) {
	// chrome.runtime.sendMessage({tab: tab, message: "Button was clicked"});
	if(openTab !== null) {
		chrome.tabs.remove(openTab);
		openTab = null;
	}
	chrome.tabs.create({ url: process.env.WEB_HOST }, tab => {
		openTab = tab.id;
	});
});

console.log('background loaded')

const popouts = {};
const popoutPromises = {};

const injectable = {
	getVersion:() => `extension_${require('../package.json').version}`,

	/************************************/
	/**       SIGNING & WALLET         **/
	/************************************/
	availableBlockchains:wallet.availableBlockchains,
	exists:wallet.exists,
	unlocked:wallet.isUnlocked,
	unlock:wallet.unlock,
	lock:wallet.lock,
	verifyPassword:wallet.verifyPassword,
	changePassword:wallet.changePassword,
	hardwareTypes:async () => wallet.hardwareTypes,
	hardwareKey:wallet.getHardwareKey,
	getPrivateKey:wallet.getPrivateKey,
	sign:wallet.sign,
	encrypt:wallet.encrypt,
	decrypt:wallet.decrypt,
	getSalt:storage.getSalt,
	setSalt:storage.setSalt,



	/************************************/
	/**        FILES / STORAGE         **/
	/************************************/
	storage:{
		getUIType:storage.getUIType,
		setUIType:storage.setUIType,

		setWalletData:wallet.updateScatter,
		getWalletData:wallet.getScatter,
		clearWalletData:storage.removeScatter,
		getDefaultPath:files.getDefaultPath,

		saveFile:files.saveFile,
		openFile:files.openFile,
		getFileLocation:files.getFileLocation,
		getFolderLocation:files.getFolderLocation,
		mkdir:files.existsOrMkdir,

		cacheABI:storage.cacheABI,
		getCachedABI:storage.getCachedABI,
		getTranslation:storage.getTranslation,
		setTranslation:storage.setTranslation,
		getHistory:storage.getHistory,
		updateHistory:storage.updateHistory,
		deltaHistory:storage.deltaHistory,
		swapHistory:storage.swapHistory,
	},


	/************************************/
	/**           UTILITIES            **/
	/************************************/
	utility:{
		openTools:(windowId = null) => console.log(`Can't open tools from an extension!`),
		closeWindow:() => {
			chrome.tabs.remove(openTab);
			return true;
		},
		flashWindow:() => console.error('flashing not implemented'),
		openLink:(link, filepath = false) => {
			if(filepath || link.indexOf('http') === -1) return console.error(`Extensions can't open local files`);
			chrome.tabs.create({ url: link });
			return console.log(`implement openLink!`)
		},
		reload:() => {
			chrome.tabs.reload(openTab);
			return true;
		},
		copy:(text) => {
			const hiddenElement = document.createElement('textarea');
			hiddenElement.value = text;
			hiddenElement.setAttribute('readonly', '');
			hiddenElement.style.position = 'absolute';
			hiddenElement.style.left = '-9999px';
			document.body.appendChild(hiddenElement);
			hiddenElement.select();
			document.execCommand('copy');
			document.body.removeChild(hiddenElement);
			return true;
        },
		screenshot:(windowId) => {
			return console.log(`screenshotting is probably not possible with extensions!`)
		},
		getPopOut:async id => {
			if(!popouts.hasOwnProperty(id)) return;
			const popout = popouts[id];
			delete popouts[id];
			return {
				scatter:await wallet.getScatter(),
				popout
			}
		},
		openPopOut:async (popout) => {
			popouts[popout.id] = popout;
			const {promise, resolver, win} = await windows.openPopOut(popout);
			popoutPromises[popout.id] = resolver;
			return promise;
		},
		popoutResponse:({original, result}) => {
			if(popoutPromises.hasOwnProperty(original.id)) {
				popoutPromises[original.id]({original, result});
				delete popoutPromises[original.id];
			}
			return true;
		},
		socketResponse:() => {},
		pushNotification:() => {}
	},

	sockets:PseudoSockets,
};




export default class Background {

	constructor(){
		this.setupInternalMessaging();
	}



	/********************************************/
	/*               VueInitializer             */
	/********************************************/

	// Watches the internal messaging system ( LocalStream )
	setupInternalMessaging(){
		this.initInternalWallet();

		LocalStream.watch(async (request, sendResponse) => {
			console.log('request', request);

			if(request.type === 'unlocked'){
				sendResponse(injectable.unlocked());
				return true;
			}

			if(request.type === 'api'){
				sendResponse(await Background.handleApiRequest(request.payload));
				return true;
			}

			if(request.type === 'popout'){
				popouts[request.popout.id] = request.popout;
				return true;
			}

			if(request.type === 'embedder') {
				sendResponse(await embedder.checkEmbed());
				return true;
			}

			const fn = request.prop
				? injectable[request.prop][request.key](...request.params)
				: injectable[request.key](...request.params);
			sendResponse(await fn);

			// Required to keep alive
			return true;
		})
	}

	initInternalWallet(){
		const noop = () => true;
		WalletPack.initialize(
			{
				blockchains:{
					EOSIO:'eos',
					ETH:'eth',
					TRX:'trx',
					BTC:'btc',
				},
				plugins:[
					require('@walletpack/eosio').default,
					require('@walletpack/ethereum').default,
					require('@walletpack/tron').default,
					require('@walletpack/bitcoin').default,
				]
			},
			// Store being injected later
			{},
			{
				getSalt:injectable.getSalt,
				get:noop,
				set:noop,
				clear:noop,
			},
			{
				getVersion:noop,
				pushNotification:noop,
			},
			// event listener
			async (type, data) => {
				if(type === 'popout') {
					// const popup =  new Popup(PopupDisplayTypes.POP_OUT, new PopupData(data.type, data));
					const popup =  {
						id:data.id,
						displayType:'popout',
						data:{
							type:data.type,
							props:data,
						},
						internal:false,
					};
					popup.data.props.appData = AppsService.getAppDataFromServer(popup.data.props.payload.origin);
					return await injectable.utility.openPopOut(popup);
				}
			},
			{
				signer:async (network, publicKey, payload, arbitrary = false, isHash = false) => {
					return injectable.sign(network, publicKey, payload, arbitrary, isHash);
				},
			}
		);

		StoreService.get = () => ({
			state:{
				scatter:injectable.unlocked() ? Scatter.fromJson(injectable.storage.getWalletData()) : null,
			},
			dispatch:(key, data) => {
				if(key === 'setScatter'){
					return injectable.storage.setWalletData(data)
				}
			}
		});
	}

	static async handleApiRequest(request){
		if(!await injectable.unlocked()) return null;
		const result = await ApiService.handler(Object.assign(request, {plugin:request.payload.origin}));
		console.log('api request/result', request, result);
		return result;
	}

}

const background = new Background();
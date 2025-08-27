
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

import { Client, Room } from 'colyseus.js';
import { DraftState } from '../../../src/rooms/schema/DraftState.ts';

export default class MainMenu extends Phaser.Scene {
	client: Client;
	room: Room;

	private play_button: Phaser.GameObjects.Image;

	constructor() {
		super("MainMenu");
		this.client = new Client(`${import.meta.env.VITE_BACKEND_URL}`);

		/* START-USER-CTR-CODE */
		/* END-USER-CTR-CODE */
	}
	async joinRoom() {
		console.log("Joining room...");

		try {
			this.room = await this.client.create('draft_room');
			console.log('room', this.room);
			console.log('client', this.client);
			console.log("Joined successfully!");
			this.room.onMessage('*', (type, message) => {
				console.log('message: ', type, message);
			});
			this.room.onStateChange((state: DraftState) => {
				console.log('state: ', state);
				console.log(state.player.name);
			})
			this.scene.start("DraftRoom", {room: this.room});

		} catch (e) {
			console.error(e);


		}
	}

	editorCreate(): void {

		// Title
		const title = this.add.text(644, 171, "", {});
		title.scaleX = 6;
		title.scaleY = 6;
		title.setOrigin(0.5, 0.5);
		title.tintFill = true;
		title.tintTopLeft = 12322824;
		title.tintTopRight = 16356608;
		title.tintBottomLeft = 16106341;
		title.tintBottomRight = 13604625;
		title.text = "Chungus Battles";
		title.setStyle({ "fontFamily": "alagard", "fontSize": "24px", "shadow.offsetX": 1, "shadow.offsetY": 1 });

		// play_button
		const play_button = this.add.image(640, 457, "play-button");
		play_button.scaleX = 4;
		play_button.scaleY = 4;
		this.play_button = play_button;

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
		this.play_button.setInteractive({useHandCursor: true});
		this.play_button.on("pointerdown", () => {
			this.play_button.setTexture('play-button-pressed');
			this.joinRoom();
		});
		this.play_button.on("pointerup", () => {
			this.play_button.setTexture('play-button');
		});

	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

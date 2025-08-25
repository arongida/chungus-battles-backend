
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

import { Room } from 'colyseus.js';

export default class DraftRoom extends Phaser.Scene {
	private room: Room;

	constructor() {
		super("DraftRoom");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	init(data: {room: Room}) {
		this.room = data.room;
	}

	editorCreate(): void {

		// title
		const title = this.add.text(573, 343.3515625, "", {});
		title.text = this.room.sessionId;
		title.setStyle({ "fontFamily": "alagard", "fontSize": "32px" });

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

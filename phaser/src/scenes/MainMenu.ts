
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class MainMenu extends Phaser.Scene {
	private play_button: Phaser.GameObjects.Image;

	constructor() {
		super("MainMenu");

		/* START-USER-CTR-CODE */
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// title
		const title = this.add.text(644, 171, "", {});
		title.scaleX = 4.775803204097774;
		title.scaleY = 5.218153137548922;
		title.setOrigin(0.5, 0.5);
		title.tintTopLeft = 16145500;
		title.tintTopRight = 15973173;
		title.tintBottomLeft = 9466115;
		title.tintBottomRight = 13764669;
		title.text = "Chungus Battles";
		title.setStyle({  });

		// play_button
		const play_button = this.add.image(640, 457, "play-button");
		this.play_button = play_button;
		play_button.scaleX = 4;
		play_button.scaleY = 4;

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
		this.play_button.setInteractive({useHandCursor: true});
		this.play_button.on("pointerdown", () => {
			this.play_button.setTexture('play-button-pressed');
		});
		this.play_button.on("pointerup", () => {
			this.play_button.setTexture('play-button');
		});

	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

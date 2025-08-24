
// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class MainMenu extends Phaser.Scene {

	constructor() {
		super("MainMenu");

		/* START-USER-CTR-CODE */
		// Write your code here.
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

		// container_1
		const container_1 = this.add.container(0, 0);

		// stoneButtonInsetHovered
		const stoneButtonInsetHovered = this.add.image(640, 360, "stoneButtonInsetHovered");
		container_1.add(stoneButtonInsetHovered);

		// buttonText
		const buttonText = this.add.text(640, 360, "", {});
		buttonText.setOrigin(0.5, 0.5);
		buttonText.text = "START";
		buttonText.setStyle({ "fontSize": "50px" });
		container_1.add(buttonText);

		this.stoneButtonInsetHovered = stoneButtonInsetHovered;

		this.events.emit("scene-awake");
	}

	private stoneButtonInsetHovered!: Phaser.GameObjects.Image;

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();

	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

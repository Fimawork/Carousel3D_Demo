import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {CameraManager,UpdateCameraPosition,CameraDefaultPos, InputEvent,Camera_Inspector,ControlsTargetDefaultPos,SetDefaultCameraStatus,InstFBXLoader,InstGLTFLoader,FindMataterialByName,posData} from 'https://cdn.jsdelivr.net/gh/Fimawork/threejs_tools/fx_functions.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

//Outline
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

let scene, camera, renderer, stats, mixer, clock;
let controls;
let threeContainer = document.getElementById("threeContainer");

const modelPosition=new THREE.Vector3(0,0,0);
const modelRotation=new THREE.Vector3(0,Math.PI, 0);
const modeScale=0.1;

let mousePos = { x: undefined, y: undefined };
let hoverPos = { x: undefined, y: undefined };
let current_INTERSECTED,INTERSECTED;
//////Raycaster工具//////
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

//影子工具
const PLANE_WIDTH = 100;
const PLANE_HEIGHT = 100;
const CAMERA_HEIGHT = 20;//必須高於模型，否則看不到

const state = {
	shadow: //影子
	{
		blur: 1.8,
		darkness: 1,
		opacity: 1,
	},
	plane: //地板材質
	{
		color: '#ffffff',
		opacity: 0,
	},
	
	showWireframe: false,
};

let shadowGroup, renderTarget, renderTargetBlur, shadowCamera, depthMaterial, horizontalBlurMaterial, verticalBlurMaterial;

let plane, blurPlane, fillPlane;



init();
animate();
EventListener();
Camera_Inspector(camera,controls);



function init()
{
  scene = new THREE.Scene();
  //scene.background= new THREE.Color( 0xFFFFFF );
  camera = new THREE.PerspectiveCamera( 50, threeContainer.clientWidth / threeContainer.clientHeight, 0.1, 1000 );//非全螢幕比例設定
  renderer = new THREE.WebGLRenderer({ antialias: true });
  //renderer.setSize( threeContainer.clientWidth, threeContainer.clientHeight );//非全螢幕比例設定

  //提高渲染解析度渲染後縮小顯示
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);

  renderer.setClearColor(0x000000, 0.0);//需加入這一條，否則看不到CSS的底圖
  //renderer.toneMapping = THREE.ACESFilmicToneMapping;
  //renderer.toneMappingExposure = 0.5;
  //document.body.appendChild( renderer.domElement );
  threeContainer.appendChild( renderer.domElement );

  const CameraDefaultPos=new THREE.Vector3(-6.311,12.489,-8.060);
  const ControlsTargetDefaultPos=new THREE.Vector3(-0.966,1.459,-0.701);
  camera.position.copy(CameraDefaultPos);
  posData[0]={ camera_pos:CameraDefaultPos, controlsTarget_pos:ControlsTargetDefaultPos};


  ///利用座標設定旋轉中心及鏡頭焦點，camera不須另外設定初始角度
  controls = new OrbitControls( camera, renderer.domElement );
  controls.enablePan = true;//右鍵平移效果
  controls.panSpeed = 0.4;
  controls.enableDamping = true;
  controls.dampingFactor =0.05;
  controls.maxDistance = 500;
  controls.target.copy( ControlsTargetDefaultPos );
  controls.zoomSpeed=0.5;
  controls.update();

  ///hdri 環境光源
  new RGBELoader()
					.setPath( 'textures/hdri/' )
					.load( 'studio_small_09_2k.hdr', function ( texture ) {

						texture.mapping = THREE.EquirectangularReflectionMapping;

						//scene.background = texture;
						scene.environment = texture;

	} );


	///影子工具
  	// the container, if you need to move the plane just move this
	shadowGroup = new THREE.Group();
	shadowGroup.position.y = 0;
	scene.add( shadowGroup );

	// the render target that will show the shadows in the plane texture
	renderTarget = new THREE.WebGLRenderTarget( 512, 512 );
	renderTarget.texture.generateMipmaps = false;

	// the render target that we will use to blur the first render target
	renderTargetBlur = new THREE.WebGLRenderTarget( 512, 512 );
	renderTargetBlur.texture.generateMipmaps = false;


	// make a plane and make it face up
	const planeGeometry = new THREE.PlaneGeometry( PLANE_WIDTH, PLANE_HEIGHT ).rotateX( Math.PI / 2 );
	const planeMaterial = new THREE.MeshBasicMaterial( {
		map: renderTarget.texture,//地板使用影子攝影機的renderTexture材質球
		opacity: state.shadow.opacity,
		transparent: true,
		depthWrite: false,
	} );
				
	plane = new THREE.Mesh( planeGeometry, planeMaterial );
				// make sure it's rendered after the fillPlane
	plane.renderOrder = 1;
	shadowGroup.add( plane );

	// the y from the texture is flipped!
	plane.scale.y = - 1;

	// the plane onto which to blur the texture
	blurPlane = new THREE.Mesh( planeGeometry );
	blurPlane.visible = false;
	shadowGroup.add( blurPlane );

	// the plane with the color of the ground
	const fillPlaneMaterial = new THREE.MeshBasicMaterial( {
		color: state.plane.color,
		opacity: state.plane.opacity,
		transparent: true,
		depthWrite: false,
	} );

	fillPlane = new THREE.Mesh( planeGeometry, fillPlaneMaterial );
	fillPlane.rotateX( Math.PI );
	shadowGroup.add( fillPlane );

	//利用相機從正上方錄製正投影畫面，製作成影子
	// the camera to render the depth material from
	shadowCamera = new THREE.OrthographicCamera( - PLANE_WIDTH / 2, PLANE_WIDTH / 2, PLANE_HEIGHT / 2, - PLANE_HEIGHT / 2, 0, CAMERA_HEIGHT );
	shadowCamera.rotation.x = Math.PI / 2; // get the camera to look up
	shadowGroup.add( shadowCamera );


	// like MeshDepthMaterial, but goes from black to transparent
	depthMaterial = new THREE.MeshDepthMaterial();
	depthMaterial.userData.darkness = { value: state.shadow.darkness };
	depthMaterial.onBeforeCompile = function ( shader ) {

		shader.uniforms.darkness = depthMaterial.userData.darkness;
		shader.fragmentShader = /* glsl */`
		uniform float darkness;
		${shader.fragmentShader.replace(
		'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
		'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
		)}
	`;

	};

	depthMaterial.depthTest = false;
	depthMaterial.depthWrite = false;

	horizontalBlurMaterial = new THREE.ShaderMaterial( HorizontalBlurShader );
	horizontalBlurMaterial.depthTest = false;

	verticalBlurMaterial = new THREE.ShaderMaterial( VerticalBlurShader );
	verticalBlurMaterial.depthTest = false;

    depthMaterial.userData.darkness.value = state.shadow.darkness;
	plane.material.opacity = state.shadow.opacity;
	fillPlane.material.color = new THREE.Color( state.plane.color );
	fillPlane.material.opacity = state.plane.opacity;

 

  ///主要物件
	const defaultScenes = 
  [
    () => new Promise((resolve) => setTimeout(() => { InstGLTFLoader('./models/FC001-128-A.glb',modelPosition,modelRotation,modeScale,"FixedAngleWithSlidePanel",null, scene);; resolve(); }, 10)),//Loading頁面   
	];

	async function SetupDefaultScene() 
  {
		for (const task of defaultScenes) 
    {
			await task(); // 確保每個任務依次完成
		}
		
    console.log('All scenes loaded');
	}

	SetupDefaultScene();


  ///EventListener
  window.addEventListener( 'resize', onWindowResize );  
  window.addEventListener("pointerdown", (event) => {
    InputEvent();
     mousePos = { x: event.clientX, y: event.clientY };
		onPointerMove(event);//改以點擊作為Raycast判斷的時間點，改善觸控螢幕誤判狀況
  });
  window.addEventListener("wheel", (event) => {InputEvent();});

}


function onWindowResize() 
{
    camera.aspect = threeContainer.clientWidth/threeContainer.clientHeight;//非全螢幕比例設定
		camera.updateProjectionMatrix();
    renderer.setSize( threeContainer.clientWidth, threeContainer.clientHeight);
}

function animate() 
{
  	requestAnimationFrame( animate );

	ShaderTargetTextureRendering();

  	controls.update();
  	renderer.render( scene, camera );

  	UpdateCameraPosition(camera,controls);
  	RaycastFunction();
}

function ShaderTargetTextureRendering()
{
	// remove the background
	const initialBackground = scene.background;
	scene.background = null;

	// force the depthMaterial to everything
	scene.overrideMaterial = depthMaterial;

	// set renderer clear alpha
	const initialClearAlpha = renderer.getClearAlpha();
	renderer.setClearAlpha( 0 );

	// render to the render target to get the depths
	renderer.setRenderTarget( renderTarget );
	renderer.render( scene, shadowCamera );

	// and reset the override material
	scene.overrideMaterial = null;

	blurShadow( state.shadow.blur );

	// a second pass to reduce the artifacts
	// (0.4 is the minimum blur amount so that the artifacts are gone)
	blurShadow( state.shadow.blur * 0.4 );

	// reset and render the normal scene
	renderer.setRenderTarget( null );
	renderer.setClearAlpha( initialClearAlpha );
	scene.background = initialBackground;

	function blurShadow( amount ) 
	{

		blurPlane.visible = true;

		// blur horizontally and draw in the renderTargetBlur
		blurPlane.material = horizontalBlurMaterial;
		blurPlane.material.uniforms.tDiffuse.value = renderTarget.texture;
		horizontalBlurMaterial.uniforms.h.value = amount * 1 / 256;

		renderer.setRenderTarget( renderTargetBlur );
		renderer.render( blurPlane, shadowCamera );

		// blur vertically and draw in the main renderTarget
		blurPlane.material = verticalBlurMaterial;
		blurPlane.material.uniforms.tDiffuse.value = renderTargetBlur.texture;
		verticalBlurMaterial.uniforms.v.value = amount * 1 / 256;

		renderer.setRenderTarget( renderTarget );
		renderer.render( blurPlane, shadowCamera );

		blurPlane.visible = false;

	}
}



function EventListener()
{
  window.addEventListener("keydown",function (event) {

      switch (event.code) 
      {

        case "Space":
        //MoveModelOFF();

        break;

        case "ArrowDown":

       //console.log(scene);


        break;

        case "ArrowUp":
        
        //EditMode(1);

        
        break;

        case "ArrowLeft":

        break;

        case "ArrowRight":

        break;
      }
      
  });

  ///滑鼠點擊accessory可啟用模型移動面板
  window.addEventListener("pointerdown", function(e) {
    
  });


  window.addEventListener( 'pointermove', function(e) {

  });
}

//////Raycaster工具//////
function onPointerMove( event ) 
{
	pointer.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	pointer.y = - ( event.clientY / window.innerHeight ) * 2 + 1;	
}

function RaycastFunction()
{
	// update the picking ray with the camera and pointer position
	raycaster.setFromCamera( pointer, camera );
		
	const intersects = raycaster.intersectObjects( scene.children);
		
	if ( intersects.length > 0 ) 
	{
		if ( INTERSECTED != intersects[ 0 ].object ) 
		{
			INTERSECTED = intersects[ 0 ].object;
			
      INTERSECTED.traverseAncestors( function ( object ) {

        if (object.parent===scene) 
        //往父層回推，將INTERSECTED重新指定為在scene底下第一層的type為Object3D的物件	
        {
          INTERSECTED=object;
        }
			
      } );
		}
	} 

	else 
	{
		INTERSECTED = null;
	}
}



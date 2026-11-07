import{r as S,j as z}from"./index-CHGRlOG_.js";import{e as K,a as q,_ as V,u as H,C as J}from"./extends-CxGl3OlT.js";import{h as N,bb as Q,bc as ee,d as te,ag as re,r as oe,a as k,q as ne,j as R,W as X,P as ie,o as ae,bd as se,as as le,av as ce,m as Y,x as ue,n as E,y as Z,l as fe}from"./three.module-DmSt39gJ.js";import{O as me}from"./OrbitControls-DwA5YGgy.js";const ve={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
      varying vec2 vUv;

      void main() {

        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float h;

    varying vec2 vUv;

    void main() {

    	vec4 sum = vec4( 0.0 );

    	sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;

    	gl_FragColor = sum;

    }
  `},de={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
    varying vec2 vUv;

    void main() {

      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    }
  `,fragmentShader:`

  uniform sampler2D tDiffuse;
  uniform float v;

  varying vec2 vUv;

  void main() {

    vec4 sum = vec4( 0.0 );

    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;

    gl_FragColor = sum;

  }
  `};function ge(e,r,v,o){var i;return i=class extends N{constructor(d){super({vertexShader:r,fragmentShader:v,...d});for(const n in e)this.uniforms[n]=new Q(e[n]),Object.defineProperty(this,n,{get(){return this.uniforms[n].value},set(u){this.uniforms[n].value=u}});this.uniforms=ee.clone(this.uniforms)}},i.key=te.generateUUID(),i}const pe=()=>parseInt(re.replace(/\D+/g,"")),he=pe(),xe=ge({cellSize:.5,sectionSize:1,fadeDistance:100,fadeStrength:1,fadeFrom:1,cellThickness:.5,sectionThickness:1,cellColor:new R,sectionColor:new R,infiniteGrid:!1,followCamera:!1,worldCamProjPosition:new k,worldPlanePosition:new k},`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform vec3 worldPlanePosition;
    uniform float fadeDistance;
    uniform bool infiniteGrid;
    uniform bool followCamera;

    void main() {
      localPosition = position.xzy;
      if (infiniteGrid) localPosition *= 1.0 + fadeDistance;
      
      worldPosition = modelMatrix * vec4(localPosition, 1.0);
      if (followCamera) {
        worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
        localPosition = (inverse(modelMatrix) * worldPosition).xyz;
      }

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform float cellSize;
    uniform float sectionSize;
    uniform vec3 cellColor;
    uniform vec3 sectionColor;
    uniform float fadeDistance;
    uniform float fadeStrength;
    uniform float fadeFrom;
    uniform float cellThickness;
    uniform float sectionThickness;

    float getGrid(float size, float thickness) {
      vec2 r = localPosition.xz / size;
      vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
      float line = min(grid.x, grid.y) + 1.0 - thickness;
      return 1.0 - min(line, 1.0);
    }

    void main() {
      float g1 = getGrid(cellSize, cellThickness);
      float g2 = getGrid(sectionSize, sectionThickness);

      vec3 from = worldCamProjPosition*vec3(fadeFrom);
      float dist = distance(from, worldPosition.xyz);
      float d = 1.0 - min(dist / fadeDistance, 1.0);
      vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));

      gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
      gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
      if (gl_FragColor.a <= 0.0) discard;

      #include <tonemapping_fragment>
      #include <${he>=154?"colorspace_fragment":"encodings_fragment"}>
    }
  `),we=S.forwardRef(({args:e,cellColor:r="#000000",sectionColor:v="#2080ff",cellSize:o=.5,sectionSize:i=1,followCamera:d=!1,infiniteGrid:n=!1,fadeDistance:u=100,fadeStrength:g=1,fadeFrom:a=1,cellThickness:t=.5,sectionThickness:p=1,side:h=ne,...x},f)=>{K({GridMaterial:xe});const s=S.useRef(null);S.useImperativeHandle(f,()=>s.current,[]);const m=new oe,c=new k(0,1,0),y=new k(0,0,0);q(M=>{m.setFromNormalAndCoplanarPoint(c,y).applyMatrix4(s.current.matrixWorld);const l=s.current.material,P=l.uniforms.worldCamProjPosition,U=l.uniforms.worldPlanePosition;m.projectPoint(M.camera.position,P.value),U.value.set(0,0,0).applyMatrix4(s.current.matrixWorld)});const D={cellSize:o,sectionSize:i,cellColor:r,sectionColor:v,cellThickness:t,sectionThickness:p},T={fadeDistance:u,fadeStrength:g,fadeFrom:a,infiniteGrid:n,followCamera:d};return S.createElement("mesh",V({ref:s,frustumCulled:!1},x),S.createElement("gridMaterial",V({transparent:!0,"extensions-derivatives":!0,side:h},D,T)),S.createElement("planeGeometry",{args:e}))}),ye=S.forwardRef(({scale:e=10,frames:r=1/0,opacity:v=1,width:o=1,height:i=1,blur:d=1,near:n=0,far:u=10,resolution:g=512,smooth:a=!0,color:t="#000000",depthWrite:p=!1,renderOrder:h,...x},f)=>{const s=S.useRef(null),m=H(A=>A.scene),c=H(A=>A.gl),y=S.useRef(null);o=o*(Array.isArray(e)?e[0]:e||1),i=i*(Array.isArray(e)?e[1]:e||1);const[D,T,M,l,P,U,C]=S.useMemo(()=>{const A=new X(g,g),I=new X(g,g);I.texture.generateMipmaps=A.texture.generateMipmaps=!1;const b=new ie(o,i).rotateX(Math.PI/2),G=new ae(b),F=new se;F.depthTest=F.depthWrite=!1,F.onBeforeCompile=_=>{_.uniforms={..._.uniforms,ucolor:{value:new R(t)}},_.fragmentShader=_.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),_.fragmentShader=_.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};const O=new N(ve),W=new N(de);return W.depthTest=O.depthTest=!1,[A,b,F,G,O,W,I]},[g,o,i,e,t]),B=A=>{l.visible=!0,l.material=P,P.uniforms.tDiffuse.value=D.texture,P.uniforms.h.value=A*1/256,c.setRenderTarget(C),c.render(l,y.current),l.material=U,U.uniforms.tDiffuse.value=C.texture,U.uniforms.v.value=A*1/256,c.setRenderTarget(D),c.render(l,y.current),l.visible=!1};let w=0,j,L;return q(()=>{y.current&&(r===1/0||w<r)&&(w++,j=m.background,L=m.overrideMaterial,s.current.visible=!1,m.background=null,m.overrideMaterial=M,c.setRenderTarget(D),c.render(m,y.current),B(d),a&&B(d*.4),c.setRenderTarget(null),s.current.visible=!0,m.overrideMaterial=L,m.background=j)}),S.useImperativeHandle(f,()=>s.current,[]),S.createElement("group",V({"rotation-x":Math.PI/2},x,{ref:s}),S.createElement("mesh",{renderOrder:h,geometry:T,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},S.createElement("meshBasicMaterial",{transparent:!0,map:D.texture,opacity:v,depthWrite:p})),S.createElement("orthographicCamera",{ref:y,args:[-o/2,o/2,i/2,-i/2,n,u]}))});class Pe extends le{constructor(r){super(r)}load(r,v,o,i){const d=this,n=new ce(this.manager);n.setPriority(this.priority),n.setCache(this.cache),n.setPath(this.path),n.setResponseType("arraybuffer"),n.setRequestHeader(this.requestHeader),n.setWithCredentials(this.withCredentials),n.load(r,function(u){try{v(d.parse(u))}catch(g){i?i(g):console.error(g),d.manager.itemError(r)}},o,i)}parse(r){function v(a){const t=new DataView(a),p=32/8*3+32/8*3*3+16/8,h=t.getUint32(80,!0);if(80+32/8+h*p===t.byteLength)return!0;const f=[115,111,108,105,100];for(let s=0;s<5;s++)if(o(f,t,s))return!1;return!0}function o(a,t,p){for(let h=0,x=a.length;h<x;h++)if(a[h]!==t.getUint8(p+h))return!1;return!0}function i(a){const t=new DataView(a),p=t.getUint32(80,!0);let h,x,f,s=!1,m,c,y,D,T;for(let w=0;w<=70;w++)t.getUint32(w,!1)==1129270351&&t.getUint8(w+4)==82&&t.getUint8(w+5)==61&&(s=!0,m=new Float32Array(p*3*3),c=t.getUint8(w+6)/255,y=t.getUint8(w+7)/255,D=t.getUint8(w+8)/255,T=t.getUint8(w+9)/255);const M=84,l=50,P=new Y,U=new Float32Array(p*3*3),C=new Float32Array(p*3*3),B=new R;for(let w=0;w<p;w++){const j=M+w*l,L=t.getFloat32(j,!0),A=t.getFloat32(j+4,!0),I=t.getFloat32(j+8,!0);if(s){const b=t.getUint16(j+48,!0);(b&32768)===0?(h=(b&31)/31,x=(b>>5&31)/31,f=(b>>10&31)/31):(h=c,x=y,f=D)}for(let b=1;b<=3;b++){const G=j+b*12,F=w*3*3+(b-1)*3;U[F]=t.getFloat32(G,!0),U[F+1]=t.getFloat32(G+4,!0),U[F+2]=t.getFloat32(G+8,!0),C[F]=L,C[F+1]=A,C[F+2]=I,s&&(B.setRGB(h,x,f,ue),m[F]=B.r,m[F+1]=B.g,m[F+2]=B.b)}}return P.setAttribute("position",new E(U,3)),P.setAttribute("normal",new E(C,3)),s&&(P.setAttribute("color",new E(m,3)),P.hasColors=!0,P.alpha=T),P}function d(a){const t=new Y,p=/solid([\s\S]*?)endsolid/g,h=/facet([\s\S]*?)endfacet/g,x=/solid\s(.+)/;let f=0;const s=/[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source,m=new RegExp("vertex"+s+s+s,"g"),c=new RegExp("normal"+s+s+s,"g"),y=[],D=[],T=[],M=new k;let l,P=0,U=0,C=0;for(;(l=p.exec(a))!==null;){U=C;const B=l[0],w=(l=x.exec(B))!==null?l[1]:"";for(T.push(w);(l=h.exec(B))!==null;){let A=0,I=0;const b=l[0];for(;(l=c.exec(b))!==null;)M.x=parseFloat(l[1]),M.y=parseFloat(l[2]),M.z=parseFloat(l[3]),I++;for(;(l=m.exec(b))!==null;)y.push(parseFloat(l[1]),parseFloat(l[2]),parseFloat(l[3])),D.push(M.x,M.y,M.z),A++,C++;I!==1&&console.error("THREE.STLLoader: Something isn't right with the normal of face number "+f),A!==3&&console.error("THREE.STLLoader: Something isn't right with the vertices of face number "+f),f++}const j=U,L=C-U;t.userData.groupNames=T,t.addGroup(j,L,P),P++}return t.setAttribute("position",new Z(y,3)),t.setAttribute("normal",new Z(D,3)),t}function n(a){return typeof a!="string"?new TextDecoder().decode(a):a}function u(a){if(typeof a=="string"){const t=new Uint8Array(a.length);for(let p=0;p<a.length;p++)t[p]=a.charCodeAt(p)&255;return t.buffer||t}else return a}const g=u(r);return v(g)?i(g):d(n(r))}}function De(e,r=1e-4){r=Math.max(r,Number.EPSILON);const v={},o=e.getIndex(),i=e.getAttribute("position"),d=o?o.count:i.count;let n=0;const u=Object.keys(e.attributes),g=[],a=new Map,t=[],p=["getX","getY","getZ","getW"],h=r*.5,x=Math.log10(1/r),f=Math.pow(10,x),s=h*f;for(let c=0;c<d;c++){const y=o?o.getX(c):c;let D="";for(let T=0,M=u.length;T<M;T++){const l=u[T],P=e.getAttribute(l),U=P.itemSize;for(let C=0;C<U;C++)D+=`${Math.trunc(P[p[C]](y)*f+s)},`}D in v?t.push(v[D]):(g.push(y),v[D]=n,t.push(n),n++)}const m=e.clone();for(const c in e.attributes)m.setAttribute(c,$(e.attributes[c],g,a));for(const c in e.morphAttributes)m.morphAttributes[c]=e.morphAttributes[c].map(y=>$(y,g,a));return m.setIndex(t),m}function $(e,r,v=new Map){const o=e.isInterleavedBufferAttribute,i=o?e.data:e,d=o?i.stride:e.itemSize;let n=o?v.get(i):void 0;if(n===void 0){const g=new i.array.constructor(r.length*d);for(let a=0;a<r.length;a++)for(let t=0;t<d;t++)g[a*d+t]=i.array[r[a]*d+t];n=o?new i.constructor(g,d,i.meshPerAttribute):new e.constructor(g,e.itemSize,e.normalized,e.meshPerAttribute),n.setUsage(i.usage),o&&v.set(i,n)}const u=o?new e.constructor(n,e.itemSize,e.offset,e.normalized):n;return u.name=e.name,o||(u.gpuType=e.gpuType),u}function Fe(e){let r=new Pe().parse(e);const v=r.getAttribute("position").count/3;r.deleteAttribute("normal"),r=De(r,1e-4),r.computeVertexNormals(),r.computeBoundingBox();const o=r.boundingBox,i=(o.min.x+o.max.x)/2,d=(o.min.z+o.max.z)/2;r.translate(-i,-o.min.y,-d),r.computeBoundingBox(),r.computeBoundingSphere();const n=r.getAttribute("position"),u=r.getIndex();let g=0;const a=new k,t=new k,p=new k,h=u?u.count:n.count;for(let f=0;f<h;f+=3){const s=u?u.getX(f):f,m=u?u.getX(f+1):f+1,c=u?u.getX(f+2):f+2;a.fromBufferAttribute(n,s),t.fromBufferAttribute(n,m),p.fromBufferAttribute(n,c),g+=a.dot(t.cross(p))/6}const x=new k;return r.boundingBox.getSize(x),{geometry:r,stats:{triangles:v,volumeCm3:Math.abs(g)/1e3,size:[x.x,x.y,x.z]}}}function Se(e){const r=S.useMemo(()=>{const v=new fe({color:new R(e.color),roughness:e.roughness,metalness:e.metalness,clearcoat:e.clearcoat??0,clearcoatRoughness:.45,transmission:e.transmission??0,thickness:e.transmission?28:0,ior:1.5,attenuationColor:new R("#9fcfff"),attenuationDistance:e.transmission?220:1/0,sheen:e.key==="silk-gold"?.4:0,sheenColor:new R("#fff1c4")});return v.onBeforeCompile=o=>{o.uniforms.uLayer={value:e.layer},o.uniforms.uAmp={value:e.amp},o.vertexShader=o.vertexShader.replace("#include <common>",`#include <common>
varying float vLcY;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vLcY = position.y;`),o.fragmentShader=o.fragmentShader.replace("#include <common>",`#include <common>
varying float vLcY;
uniform float uLayer;
uniform float uAmp;`).replace("#include <color_fragment>",`#include <color_fragment>
          float lcT = vLcY / uLayer;
          float lcFade = clamp(1.0 - fwidth(lcT) * 1.8, 0.0, 1.0);
          float lcS = pow(0.5 + 0.5 * cos(6.2831853 * lcT), 3.0);
          diffuseColor.rgb *= 1.0 - uAmp * lcS * lcFade;`)},v.customProgramCacheKey=()=>`lc-print-${e.layer}-${e.amp}`,v},[e]);return S.useEffect(()=>()=>r.dispose(),[r]),r}function Ue(e){const r=Se(e.finish);return z.jsx("mesh",{geometry:e.geometry,material:r,castShadow:!0,receiveShadow:!0})}function Te(e){const{geometry:r,finish:v,spin:o,active:i,height:d}=e,n=[0,d*.46,0];return z.jsxs(J,{className:"lc-canvas",style:{position:"absolute",inset:0},dpr:[1,2],frameloop:i?"always":"never",camera:{fov:30,near:5,far:4e3,position:[270,d*1.05+90,360]},gl:{antialias:!0,alpha:!0,powerPreference:"high-performance"},children:[z.jsx("hemisphereLight",{args:["#e8f0ff","#2a1f1a",.75]}),z.jsx("directionalLight",{position:[160,320,220],intensity:2.1}),z.jsx("directionalLight",{position:[-220,120,-160],intensity:.75,color:"#9fd8ff"}),z.jsx("directionalLight",{position:[0,60,320],intensity:.35,color:"#ffd6dc"}),z.jsx(Ue,{geometry:r,finish:v}),z.jsxs("mesh",{position:[0,-2.6,0],receiveShadow:!0,children:[z.jsx("boxGeometry",{args:[250,5,250]}),z.jsx("meshStandardMaterial",{color:"#141b25",roughness:.85,metalness:.15})]}),z.jsx(we,{position:[0,.05,0],args:[250,250],cellSize:10,cellThickness:.6,cellColor:"#1f2d3b",sectionSize:50,sectionThickness:1.1,sectionColor:"#2a5568",fadeDistance:1400,fadeStrength:1}),z.jsx(ye,{position:[0,.12,0],scale:300,resolution:512,blur:2.4,opacity:.75,far:170,frames:1}),z.jsx(me,{makeDefault:!0,target:n,enablePan:!1,enableZoom:!1,enableDamping:!0,rotateSpeed:.7,minPolarAngle:.25,maxPolarAngle:Math.PI/2-.04,autoRotate:o,autoRotateSpeed:1.4})]})}export{Te as StlPreview,Fe as prepareStl};

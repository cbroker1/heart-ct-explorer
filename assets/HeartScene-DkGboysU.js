import{j as h,r as R,d as le}from"./index-CHGRlOG_.js";import{C as ue,u as q,a as ce}from"./extends-CxGl3OlT.js";import{l as fe,u as me,j as $,a as j,b as pe,p as Y,ai as he,aj as re,i as ae,A as G,d as de,M as se,B as ve,c as ge,w as xe,x as ye,m as ie,y as ne,n as oe}from"./three.module-DmSt39gJ.js";import{E as be,L as X}from"./Lightformer-D3gyX1_O.js";import{O as we}from"./OrbitControls-DwA5YGgy.js";import{u as Re}from"./Gltf-BZPj1pCw.js";const H={ventricle:0,atrium:1,artery:2,vein:3};function Ae(){return{uV:{value:0},uA:{value:0},uTau:{value:1},uTs:{value:.3},uWaveA:{value:-1},uWaveV:{value:-1},uGlow:{value:0},uSlab:{value:new pe(0,0)},uSlabOn:{value:0},uTime:{value:0},uApex:{value:new j},uAxis:{value:new j(0,1,0)},uHb:{value:70},uHa:{value:50},uSA:{value:new j},uAV:{value:new j},uKL:{value:.085},uTwist:{value:.1},uKA:{value:.1},uKE:{value:1.3},uAmount:{value:1}}}const Me=`
uniform float uV, uA, uTau, uTs, uHb, uHa, uKL, uTwist, uKA, uKE, uAmount;
uniform vec3 uApex, uAxis, uAV;
uniform float uRole, uKR, uKRin, uCenterR;
uniform vec3 uCenter;
varying vec3 vHeartRest;
varying vec3 vHeartPos;
`,Se=`
  vHeartRest = transformed;
  {
    float vv = uV * uAmount;
    vec3 d = transformed - uApex;
    float h = dot(d, uAxis);
    vec3 r = d - h * uAxis;
    float hn = h / uHb;
    float rl = length(r);
    // endocardial vs epicardial surface of the muscle shell: normal pointing toward the axis = inner
    float inner = (uRole < 0.5 && rl > 1e-3) ? smoothstep(0.2, -0.3, dot(normalize(objectNormal), r / rl)) : 0.0;
    float kR = mix(uKR, uKRin, inner);
    float radial = kR * vv * smoothstep(-0.2, 0.3, hn) * (1.0 - smoothstep(1.0, 1.35, hn));
    float dh = hn <= 1.0 ? -uKL * vv * h : -uKL * vv * uHb * clamp(1.0 - (h - uHb) / uHa, 0.0, 1.0);
    float ang = uTwist * vv * (clamp(hn, 0.0, 1.0) - 0.45);
    float c = cos(ang), s = sin(ang);
    vec3 rr = r * (1.0 - radial);
    rr = rr * c + cross(uAxis, rr) * s;
    vec3 moved = uApex + (h + dh) * uAxis + rr;
    // how much of the ventricular field each kind of tissue follows
    float w = 1.0;
    if (uRole > 1.5 && uRole < 2.5) w = exp(-max(0.0, length(vHeartRest - uAV) - 12.0) / 22.0);
    if (uRole > 2.5) w = clamp(1.0 - (length(vHeartRest - uCenter) - uCenterR) / 28.0, 0.0, 1.0);
    transformed = mix(transformed, moved, w);
    // atrial systole (P wave): squeeze toward the chamber centre; veins join in near the junction
    if (uRole > 0.5 && uRole < 1.5) {
      transformed = uCenter + (transformed - uCenter) * (1.0 - uKA * uA * uAmount);
    } else if (uRole > 2.5) {
      transformed = mix(transformed, uCenter + (transformed - uCenter) * (1.0 - uKA * uA * uAmount), w);
    }
    // arteries: pressure pulse travelling away from the valves (~4.5 m/s)
    if (uRole > 1.5 && uRole < 2.5) {
      float dist = length(vHeartRest - uAV);
      float x = (uTau - 0.05 - dist / 4500.0) / max(uTs, 0.1);
      float e = (x > 0.0 && x < 1.0) ? pow(sin(3.14159265 * x), 0.7) : 0.0;
      transformed += normalize(objectNormal) * uKE * e * uAmount;
    }
  }
  vHeartPos = transformed;
`,_e=`
uniform float uWaveA, uWaveV, uGlow, uSlabOn, uTime, uHb, uRole;
uniform vec2 uSlab;
uniform vec3 uRim, uSA, uApex, uAxis;
varying vec3 vHeartRest;
varying vec3 vHeartPos;
`,je=`
  {
    vec3 nV = normalize(normal);
    vec3 vV = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(abs(dot(nV, vV)), 0.0, 1.0), 2.4);
    totalEmissiveRadiance += uRim * fres * 0.85;
    totalEmissiveRadiance += diffuseColor.rgb * uGlow * 0.32;
    // depolarisation: a spherical wave from the sinus node over the atria (P wave),
    // then a band sweeping the ventricles from apex to base (QRS)
    vec3 waveCol = vec3(0.22, 0.78, 1.0);
    float wv = 0.0;
    if (uWaveA >= 0.0 && uRole > 0.5 && uRole < 1.5) {
      float dA = length(vHeartRest - uSA);
      wv += exp(-pow((dA - uWaveA * 105.0) / 7.0, 2.0)) * (1.0 - 0.5 * uWaveA);
    }
    if (uWaveV >= 0.0 && uRole < 0.5) {
      float hn = dot(vHeartRest - uApex, uAxis) / uHb;
      wv += exp(-pow((hn - mix(-0.12, 1.1, uWaveV)) / 0.075, 2.0)) * (1.0 - 0.35 * uWaveV);
    }
    totalEmissiveRadiance += waveCol * wv * 1.05;
    // X-ray slab: the part of the heart this shot is imaging
    if (uSlabOn > 0.001) {
      float y = vHeartPos.y;
      float inside = smoothstep(uSlab.x - 1.2, uSlab.x + 1.2, y) * (1.0 - smoothstep(uSlab.y - 1.2, uSlab.y + 1.2, y));
      float edge = exp(-pow((y - uSlab.x) / 0.9, 2.0)) + exp(-pow((y - uSlab.y) / 0.9, 2.0));
      float lines = 0.7 + 0.3 * sin(y * 3.4 - uTime * 9.0);
      totalEmissiveRadiance += vec3(0.30, 0.95, 0.62) * uSlabOn * (inside * 0.26 * lines + edge * 1.1);
    }
  }
`;function ke(e,t){const s=(t.opacity??1)<1,f=new fe({color:new $(t.color).multiplyScalar(.82),roughness:.42,metalness:0,clearcoat:.8,clearcoatRoughness:.22,envMapIntensity:.9,transparent:s,opacity:t.opacity??1,depthWrite:!s,side:me}),i={uRole:{value:t.role},uKR:{value:t.kR},uKRin:{value:t.kRin??t.kR},uCenter:{value:(t.center??new j).clone()},uCenterR:{value:t.centerR??25},uRim:{value:new $(t.rim)}};return f.onBeforeCompile=m=>{Object.assign(m.uniforms,e,i),m.vertexShader=Me+m.vertexShader.replace("#include <begin_vertex>",`#include <begin_vertex>
`+Se),m.fragmentShader=_e+m.fragmentShader.replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
`+je)},f.customProgramCacheKey=()=>"hb-heart-v1",f}const Q=[{name:"heart_ventricle_left",short:"left ventricle",role:H.ventricle,kR:.13,rim:"#ff8a95"},{name:"heart_ventricle_right",short:"right ventricle",role:H.ventricle,kR:.1,rim:"#9db8ff"},{name:"heart_myocardium",short:"heart muscle",role:H.ventricle,kR:.055,kRin:.13,opacity:.5,rim:"#ff7d8a"},{name:"heart_atrium_left",short:"left atrium",role:H.atrium,kR:0,centerOf:"heart_atrium_left",rim:"#ffbdb2"},{name:"heart_atrium_right",short:"right atrium",role:H.atrium,kR:0,centerOf:"heart_atrium_right",rim:"#bccdff"},{name:"atrial_appendage_left",short:"left atrial appendage",role:H.atrium,kR:0,centerOf:"heart_atrium_left",rim:"#ffc9b6"},{name:"aorta",short:"aorta",role:H.artery,kR:0,rim:"#ff8893"},{name:"pulmonary_artery",short:"pulmonary artery",role:H.artery,kR:0,rim:"#93aaff"},{name:"pulmonary_vein",short:"pulmonary veins",role:H.vein,kR:0,centerOf:"heart_atrium_left",rim:"#ffb09e"},{name:"superior_vena_cava",short:"superior vena cava",role:H.vein,kR:0,centerOf:"heart_atrium_right",rim:"#9fb3ff"},{name:"inferior_vena_cava",short:"inferior vena cava",role:H.vein,kR:0,centerOf:"heart_atrium_right",rim:"#9fb3ff"}],Z=new $("#5dffb0");function Ve(e,t){const s=[];e.updateWorldMatrix(!0,!0);const f=new j;if(e.traverse(y=>{const a=y;if(!a.isMesh||!a.geometry)return;const x=a.geometry.getAttribute("position");if(!x)return;const T=new se().multiplyMatrices(t,a.matrixWorld),S=new Float32Array(x.count*3);for(let r=0;r<x.count;r++)f.fromBufferAttribute(x,r).applyMatrix4(T),S[3*r]=f.x,S[3*r+1]=f.y,S[3*r+2]=f.z;s.push({pos:S,idx:a.geometry.index?a.geometry.index.array:null})}),!s.length)return null;const i=s.reduce((y,a)=>y+a.pos.length/3,0),m=s.reduce((y,a)=>y+(a.idx?a.idx.length:a.pos.length/3),0),l=new Float32Array(i*3),c=i>65535?new Uint32Array(m):new Uint16Array(m);let o=0,g=0;for(const y of s){l.set(y.pos,o*3);const a=y.pos.length/3;if(y.idx)for(let x=0;x<y.idx.length;x++)c[g++]=y.idx[x]+o;else for(let x=0;x<a;x++)c[g++]=x+o;o+=a}const p=new ie;return p.setAttribute("position",new oe(l,3)),p.setIndex(new oe(c,1)),p.computeVertexNormals(),p.computeBoundingBox(),p.computeBoundingSphere(),p}function D(e){const t=new j;let s=0;for(const f of e){const i=f.getAttribute("position").array;for(let m=0;m<i.length;m+=3)t.x+=i[m],t.y+=i[m+1],t.z+=i[m+2];s+=i.length/3}return s?t.divideScalar(s):null}function J(e,t,s){const f=e.reduce((l,c)=>l+c.getAttribute("position").count,0),i=new Float32Array(f);let m=0;for(const l of e){const c=l.getAttribute("position").array;for(let o=0;o<c.length;o+=3)i[m++]=(c[o]-t.x)*s.x+(c[o+1]-t.y)*s.y+(c[o+2]-t.z)*s.z}return i.sort()}const U=(e,t)=>e.length?e[Math.min(e.length-1,Math.max(0,Math.floor(t*(e.length-1))))]:0;function Ce(e,t,s){e.updateWorldMatrix(!0,!0);const f=new se().copy(e.matrixWorld).invert(),i=new Map;for(const u of Q){const v=e.getObjectByName(u.name),w=v?Ve(v,f):null;w&&i.set(u.name,w)}const m=(...u)=>u.map(v=>i.get(v)).filter(v=>!!v),l=m("heart_ventricle_left","heart_ventricle_right"),c=m("heart_atrium_left","heart_atrium_right"),o=[...i.values()],g=D(o)??new j,p=D(l.length?l:m("heart_myocardium"))??g,a=(D(c)??g.clone().add(new j(0,40,0))).clone().sub(p);a.lengthSq()<1&&a.set(0,1,0),a.normalize();const x=J([...l,...m("heart_myocardium")],p,a),T=J(l,p,a),S=J(c,p,a),r=U(x,.004),O=c.length&&l.length?.5*(U(T,.97)+U(S,.05)):r+70,_=Math.max(30,O-r),n=Math.max(25,(c.length?U(S,.97):O+45)-O),M=p.clone().addScaledVector(a,r),A=p.clone().addScaledVector(a,O),b=(()=>{const u=i.get("heart_atrium_right"),v=i.get("superior_vena_cava");if(!u)return A.clone();const w=(v&&D([v]))??A,k=u.getAttribute("position").array;let P=1/0,V=0;for(let C=0;C<k.length;C+=3){const K=(k[C]-w.x)**2+(k[C+1]-w.y)**2+(k[C+2]-w.z)**2;K<P&&(P=K,V=C)}return new j(k[V],k[V+1],k[V+2])})(),d=Ae();d.uApex.value.copy(M),d.uAxis.value.copy(a),d.uHb.value=_,d.uHa.value=n,d.uAV.value.copy(A),d.uSA.value.copy(b);const E=[],L=new Map;for(const u of["heart_atrium_left","heart_atrium_right"]){const v=i.get(u);v&&L.set(u,{c:D([v]),r:v.boundingSphere?v.boundingSphere.radius*.6:25})}for(const u of Q){const v=i.get(u.name);if(!v)continue;const w=u.centerOf?L.get(u.centerOf):void 0,k=u.name,P=ke(d,{color:s[k]??"#d8434f",role:u.role,kR:u.kR,kRin:u.kRin,opacity:u.opacity,center:w?.c,centerR:w?.r,rim:u.rim});E.push({spec:u,geom:v,mat:P})}const W=new ve;for(const u of o)u.boundingBox&&W.union(u.boundingBox);const z=W.getCenter(new j),F=W.getBoundingSphere(new ge);let B=0;for(const u of o){const v=u.getAttribute("position").array;for(let w=0;w<v.length;w+=3)B=Math.max(B,Math.hypot(v[w]-z.x,v[w+2]-z.z))}B=B*1.06+6;const N=t.slabY.map(([u,v])=>{const w=Math.min(u,v),k=Math.max(u,v),P=[];for(const V of Q){const C=i.get(V.name);if(!C)continue;const K=C.getAttribute("position").array;let ee=0;for(let I=1;I<K.length;I+=3)K[I]>=w&&K[I]<=k&&ee++;const te=ee/(K.length/3);te>=.18&&P.push({name:V.short,f:te})}return P.sort((V,C)=>C.f-V.f).slice(0,5).map(V=>V.name)});return{parts:E,shared:d,center:z,radius:F.radius,gantryR:B,info:{coverage:N,parts:E.length}}}function He(e,t){const f=[],i=[],m=[];for(const[c,o]of[[-.5,.55],[0,1],[.5,.55]]){const g=f.length/3;f.push(e,c,0),i.push(.5*o,1*o,.72*o);for(let p=0;p<=24;p++){const y=Math.PI-t+2*t*p/24,a=1-Math.abs(p/24-.5)*1.6;f.push(e*Math.cos(y),c,e*Math.sin(y)),i.push(.04*o*a,.38*o*a,.22*o*a)}for(let p=0;p<24;p++)m.push(g,g+1+p,g+2+p)}const l=new ie;return l.setAttribute("position",new ne(f,3)),l.setAttribute("color",new ne(i,3)),l.setIndex(m),l}function Ee(){const e=document.createElement("canvas");e.width=e.height=128;const t=e.getContext("2d"),s=t.createRadialGradient(64,64,0,64,64,64);s.addColorStop(0,"rgba(255,77,94,0.55)"),s.addColorStop(.35,"rgba(255,77,94,0.18)"),s.addColorStop(1,"rgba(255,77,94,0)"),t.fillStyle=s,t.fillRect(0,0,128,128);const f=new xe(e);return f.colorSpace=ye,f}function Te({model:e,player:t,manifest:s,autoRotate:f,onReady:i}){const m=Re(le(s.meshes.heartFile??s.meshes.file)),l=R.useMemo(()=>Ce(m.scene,e,Object.fromEntries(s.meshes.nodes.map(n=>[n.name,n.color]))),[m,e,s]),c=q(n=>n.camera),o=q(n=>n.size),g=q(n=>n.controls),p=R.useRef(!1),y=R.useRef(null),a=R.useRef(null),x=R.useRef(null),T=R.useRef(null),S=R.useRef(null),r=R.useMemo(()=>{const n=l.gantryR;return{ring:new re(n,.85,10,200),edge:new re(n,.4,6,200),fan:He(n,.42),curtain:new he(n,n,1,128,1,!0),ringMat:new Y({color:Z,transparent:!0,opacity:.25,blending:G,depthWrite:!1,toneMapped:!1}),edgeMat:new Y({color:Z,transparent:!0,opacity:0,blending:G,depthWrite:!1,toneMapped:!1}),fanMat:new Y({vertexColors:!0,transparent:!0,opacity:0,blending:G,depthWrite:!1,side:ae,toneMapped:!1}),curtainMat:new Y({color:Z,transparent:!0,opacity:0,blending:G,depthWrite:!1,side:ae,toneMapped:!1}),haloTex:Ee()}},[l.gantryR]);R.useEffect(()=>()=>{for(const n of l.parts)n.geom.dispose(),n.mat.dispose()},[l]),R.useEffect(()=>()=>{r.ring.dispose(),r.edge.dispose(),r.fan.dispose(),r.curtain.dispose(),r.ringMat.dispose(),r.edgeMat.dispose(),r.fanMat.dispose(),r.curtainMat.dispose(),r.haloTex.dispose()},[r]),R.useEffect(()=>{i(l.info)},[l,i]),R.useLayoutEffect(()=>{const n=de.degToRad(c.fov),M=2*Math.atan(Math.tan(n/2)*(o.width/Math.max(1,o.height))),A=l.radius*.8/Math.sin(Math.min(n,M)/2),b=new j(.48,.4,1).normalize();c.position.copy(b.multiplyScalar(A)),c.near=A/20,c.far=A*6;const d=o.width>700?Math.min(140,o.width*.11):0;d?c.setViewOffset(o.width,o.height,d,0,o.width,o.height):c.clearViewOffset(),c.updateProjectionMatrix(),c.lookAt(0,0,0),g&&(g.target.set(0,0,0),g.minDistance=A*.55,g.maxDistance=A*1.6,g.update())},[l,c,o.width,o.height,g]),R.useEffect(()=>{if(!g)return;g.autoRotate=f&&!p.current,g.autoRotateSpeed=.55;const n=()=>{p.current=!0,g.autoRotate=!1};return g.addEventListener("start",n),()=>g.removeEventListener("start",n)},[g,f]);const O=R.useMemo(()=>new j,[]);ce(n=>{const M=l.shared,A=t.t,b=e.state(A);M.uV.value=b.v,M.uA.value=b.a,M.uTau.value=b.tau,M.uTs.value=b.ts,M.uWaveA.value=b.waveA,M.uWaveV.value=b.waveV,M.uGlow.value=.55*b.v+.4*b.a+(b.waveV>=0?.35*(1-b.waveV):0),M.uTime.value=n.clock.elapsedTime;const d=e.xray(A),E=d.i>=0?e.slabY[d.i]:e.slabY[0],L=E?Math.min(E[0],E[1]):0,W=E?Math.max(E[0],E[1]):0;M.uSlab.value.set(L,W),M.uSlabOn.value=d.on;const z=.5*(L+W),F=Math.max(1,W-L);y.current&&(y.current.position.y=e.ringY(A),r.ringMat.opacity=.2+.8*d.on),a.current&&(a.current.position.y=z,a.current.children[0].position.y=-F/2,a.current.children[1].position.y=F/2,r.edgeMat.opacity=.9*d.on);const B=d.i>=0&&A>=e.x[d.i].xray[0]-.01&&A<=e.x[d.i].xray[1]+.03;if(x.current&&(x.current.visible=B,x.current.position.y=z,x.current.scale.set(1,F,1),x.current.rotation.y=-d.angle,r.fanMat.opacity=.6*d.on),T.current&&(T.current.visible=d.on>.01,T.current.position.y=z,T.current.scale.set(1,F,1),r.curtainMat.opacity=.075*d.on),S.current){O.copy(n.camera.position).normalize().multiplyScalar(-l.radius*.9),S.current.position.copy(O);const N=.55+.45*b.v+.25*d.on;S.current.scale.setScalar(l.radius*(3+.25*b.v)),S.current.material.opacity=N}});const _=l.center;return h.jsxs(h.Fragment,{children:[h.jsx("sprite",{ref:S,renderOrder:-10,children:h.jsx("spriteMaterial",{map:r.haloTex,transparent:!0,depthWrite:!1,blending:G,toneMapped:!1})}),h.jsxs("group",{position:[-_.x,-_.y,-_.z],children:[l.parts.map(n=>h.jsx("mesh",{geometry:n.geom,material:n.mat,renderOrder:n.spec.opacity?2:0},n.spec.name)),h.jsx("mesh",{ref:y,geometry:r.ring,material:r.ringMat,rotation:[Math.PI/2,0,0],position:[_.x,0,_.z]}),h.jsxs("group",{ref:a,position:[_.x,0,_.z],children:[h.jsx("mesh",{geometry:r.edge,material:r.edgeMat,rotation:[Math.PI/2,0,0]}),h.jsx("mesh",{geometry:r.edge,material:r.edgeMat,rotation:[Math.PI/2,0,0]})]}),h.jsx("mesh",{ref:x,geometry:r.fan,material:r.fanMat,position:[_.x,0,_.z],visible:!1}),h.jsx("mesh",{ref:T,geometry:r.curtain,material:r.curtainMat,position:[_.x,0,_.z],visible:!1})]})]})}class Oe extends R.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(t){this.props.onError(String(t?.message??t))}render(){return this.state.failed?null:this.props.children}}function Fe(e){const{active:t,onError:s,...f}=e;return h.jsxs(ue,{className:"hb-canvas",dpr:[1,1.75],frameloop:t?"always":"never",gl:{antialias:!0,alpha:!0,powerPreference:"high-performance"},camera:{fov:30,near:5,far:4e3,position:[0,0,420]},onCreated:({gl:i})=>{i.setClearColor(0,0)},children:[h.jsx("ambientLight",{intensity:.22}),h.jsx("hemisphereLight",{args:["#c9dcff","#2b0a10",.6]}),h.jsx("directionalLight",{position:[-160,230,260],intensity:1.7,color:"#fff3ec"}),h.jsx("directionalLight",{position:[240,-40,-220],intensity:1.1,color:"#38d6ff"}),h.jsx("directionalLight",{position:[60,-220,160],intensity:.45,color:"#ff4d5e"}),h.jsxs(be,{resolution:128,frames:1,children:[h.jsx(X,{form:"rect",intensity:2.4,position:[0,260,160],scale:[320,120,1],color:"#ffffff"}),h.jsx(X,{form:"ring",intensity:1.8,position:[-260,40,60],scale:130,color:"#38d6ff"}),h.jsx(X,{form:"rect",intensity:1.3,position:[260,-60,110],scale:[160,220,1],color:"#ff8a95"})]}),h.jsx(Oe,{onError:s,children:h.jsx(R.Suspense,{fallback:null,children:h.jsx(Te,{...f})})}),h.jsx(we,{makeDefault:!0,enablePan:!1,enableZoom:!1,enableDamping:!0,dampingFactor:.08,minPolarAngle:.35,maxPolarAngle:2.65})]})}export{Fe as default};

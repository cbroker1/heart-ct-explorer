import{x as ue,Z as le,v as $,h as k,i as ce,j as h,r as R,d as fe,G as Y,az as me,aA as re,t as ae,A as F,n as pe,M as se,B as he,m as de,a0 as ve,a1 as ge,y as ie,a2 as ne,z as oe}from"./index-1HAv-Jhe.js";import{C as xe,u as q,a as ye}from"./extends-BTyLBu7W.js";import{E as be,L as X}from"./Lightformer-BRm_HIB-.js";import{O as we}from"./OrbitControls-BrMHcpvC.js";import{u as Re}from"./Gltf-pyLOSR9a.js";import"./three.module-D9UX2Si9.js";const H={ventricle:0,atrium:1,artery:2,vein:3};function Ae(){return{uV:{value:0},uA:{value:0},uTau:{value:1},uTs:{value:.3},uWaveA:{value:-1},uWaveV:{value:-1},uGlow:{value:0},uSlab:{value:new ce(0,0)},uSlabOn:{value:0},uTime:{value:0},uApex:{value:new k},uAxis:{value:new k(0,1,0)},uHb:{value:70},uHa:{value:50},uSA:{value:new k},uAV:{value:new k},uKL:{value:.085},uTwist:{value:.1},uKA:{value:.1},uKE:{value:1.3},uAmount:{value:1}}}const Me=`
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
`,ke=`
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
`;function je(e,t){const u=(t.opacity??1)<1,f=new ue({color:new $(t.color).multiplyScalar(.82),roughness:.42,metalness:0,clearcoat:.8,clearcoatRoughness:.22,envMapIntensity:.9,transparent:u,opacity:t.opacity??1,depthWrite:!u,side:le}),s={uRole:{value:t.role},uKR:{value:t.kR},uKRin:{value:t.kRin??t.kR},uCenter:{value:(t.center??new k).clone()},uCenterR:{value:t.centerR??25},uRim:{value:new $(t.rim)}};return f.onBeforeCompile=m=>{Object.assign(m.uniforms,e,s),m.vertexShader=Me+m.vertexShader.replace("#include <begin_vertex>",`#include <begin_vertex>
`+Se),m.fragmentShader=_e+m.fragmentShader.replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
`+ke)},f.customProgramCacheKey=()=>"hb-heart-v1",f}const Z=[{name:"heart_ventricle_left",short:"left ventricle",role:H.ventricle,kR:.13,rim:"#ff8a95"},{name:"heart_ventricle_right",short:"right ventricle",role:H.ventricle,kR:.1,rim:"#9db8ff"},{name:"heart_myocardium",short:"heart muscle",role:H.ventricle,kR:.055,kRin:.13,opacity:.5,rim:"#ff7d8a"},{name:"heart_atrium_left",short:"left atrium",role:H.atrium,kR:0,centerOf:"heart_atrium_left",rim:"#ffbdb2"},{name:"heart_atrium_right",short:"right atrium",role:H.atrium,kR:0,centerOf:"heart_atrium_right",rim:"#bccdff"},{name:"atrial_appendage_left",short:"left atrial appendage",role:H.atrium,kR:0,centerOf:"heart_atrium_left",rim:"#ffc9b6"},{name:"aorta",short:"aorta",role:H.artery,kR:0,rim:"#ff8893"},{name:"pulmonary_artery",short:"pulmonary artery",role:H.artery,kR:0,rim:"#93aaff"},{name:"pulmonary_vein",short:"pulmonary veins",role:H.vein,kR:0,centerOf:"heart_atrium_left",rim:"#ffb09e"},{name:"superior_vena_cava",short:"superior vena cava",role:H.vein,kR:0,centerOf:"heart_atrium_right",rim:"#9fb3ff"},{name:"inferior_vena_cava",short:"inferior vena cava",role:H.vein,kR:0,centerOf:"heart_atrium_right",rim:"#9fb3ff"}],Q=new $("#5dffb0");function Ve(e,t){const u=[];e.updateWorldMatrix(!0,!0);const f=new k;if(e.traverse(y=>{const a=y;if(!a.isMesh||!a.geometry)return;const x=a.geometry.getAttribute("position");if(!x)return;const T=new se().multiplyMatrices(t,a.matrixWorld),S=new Float32Array(x.count*3);for(let r=0;r<x.count;r++)f.fromBufferAttribute(x,r).applyMatrix4(T),S[3*r]=f.x,S[3*r+1]=f.y,S[3*r+2]=f.z;u.push({pos:S,idx:a.geometry.index?a.geometry.index.array:null})}),!u.length)return null;const s=u.reduce((y,a)=>y+a.pos.length/3,0),m=u.reduce((y,a)=>y+(a.idx?a.idx.length:a.pos.length/3),0),i=new Float32Array(s*3),c=s>65535?new Uint32Array(m):new Uint16Array(m);let o=0,g=0;for(const y of u){i.set(y.pos,o*3);const a=y.pos.length/3;if(y.idx)for(let x=0;x<y.idx.length;x++)c[g++]=y.idx[x]+o;else for(let x=0;x<a;x++)c[g++]=x+o;o+=a}const p=new ie;return p.setAttribute("position",new oe(i,3)),p.setIndex(new oe(c,1)),p.computeVertexNormals(),p.computeBoundingBox(),p.computeBoundingSphere(),p}function D(e){const t=new k;let u=0;for(const f of e){const s=f.getAttribute("position").array;for(let m=0;m<s.length;m+=3)t.x+=s[m],t.y+=s[m+1],t.z+=s[m+2];u+=s.length/3}return u?t.divideScalar(u):null}function J(e,t,u){const f=e.reduce((i,c)=>i+c.getAttribute("position").count,0),s=new Float32Array(f);let m=0;for(const i of e){const c=i.getAttribute("position").array;for(let o=0;o<c.length;o+=3)s[m++]=(c[o]-t.x)*u.x+(c[o+1]-t.y)*u.y+(c[o+2]-t.z)*u.z}return s.sort()}const U=(e,t)=>e.length?e[Math.min(e.length-1,Math.max(0,Math.floor(t*(e.length-1))))]:0;function Ce(e,t,u){e.updateWorldMatrix(!0,!0);const f=new se().copy(e.matrixWorld).invert(),s=new Map;for(const l of Z){const v=e.getObjectByName(l.name),w=v?Ve(v,f):null;w&&s.set(l.name,w)}const m=(...l)=>l.map(v=>s.get(v)).filter(v=>!!v),i=m("heart_ventricle_left","heart_ventricle_right"),c=m("heart_atrium_left","heart_atrium_right"),o=[...s.values()],g=D(o)??new k,p=D(i.length?i:m("heart_myocardium"))??g,a=(D(c)??g.clone().add(new k(0,40,0))).clone().sub(p);a.lengthSq()<1&&a.set(0,1,0),a.normalize();const x=J([...i,...m("heart_myocardium")],p,a),T=J(i,p,a),S=J(c,p,a),r=U(x,.004),O=c.length&&i.length?.5*(U(T,.97)+U(S,.05)):r+70,_=Math.max(30,O-r),n=Math.max(25,(c.length?U(S,.97):O+45)-O),M=p.clone().addScaledVector(a,r),A=p.clone().addScaledVector(a,O),b=(()=>{const l=s.get("heart_atrium_right"),v=s.get("superior_vena_cava");if(!l)return A.clone();const w=(v&&D([v]))??A,j=l.getAttribute("position").array;let P=1/0,V=0;for(let C=0;C<j.length;C+=3){const K=(j[C]-w.x)**2+(j[C+1]-w.y)**2+(j[C+2]-w.z)**2;K<P&&(P=K,V=C)}return new k(j[V],j[V+1],j[V+2])})(),d=Ae();d.uApex.value.copy(M),d.uAxis.value.copy(a),d.uHb.value=_,d.uHa.value=n,d.uAV.value.copy(A),d.uSA.value.copy(b);const E=[],L=new Map;for(const l of["heart_atrium_left","heart_atrium_right"]){const v=s.get(l);v&&L.set(l,{c:D([v]),r:v.boundingSphere?v.boundingSphere.radius*.6:25})}for(const l of Z){const v=s.get(l.name);if(!v)continue;const w=l.centerOf?L.get(l.centerOf):void 0,j=l.name,P=je(d,{color:u[j]??"#d8434f",role:l.role,kR:l.kR,kRin:l.kRin,opacity:l.opacity,center:w?.c,centerR:w?.r,rim:l.rim});E.push({spec:l,geom:v,mat:P})}const z=new he;for(const l of o)l.boundingBox&&z.union(l.boundingBox);const W=z.getCenter(new k),G=z.getBoundingSphere(new de);let B=0;for(const l of o){const v=l.getAttribute("position").array;for(let w=0;w<v.length;w+=3)B=Math.max(B,Math.hypot(v[w]-W.x,v[w+2]-W.z))}B=B*1.06+6;const N=t.slabY.map(([l,v])=>{const w=Math.min(l,v),j=Math.max(l,v),P=[];for(const V of Z){const C=s.get(V.name);if(!C)continue;const K=C.getAttribute("position").array;let ee=0;for(let I=1;I<K.length;I+=3)K[I]>=w&&K[I]<=j&&ee++;const te=ee/(K.length/3);te>=.18&&P.push({name:V.short,f:te})}return P.sort((V,C)=>C.f-V.f).slice(0,5).map(V=>V.name)});return{parts:E,shared:d,center:W,radius:G.radius,gantryR:B,info:{coverage:N,parts:E.length}}}function He(e,t){const f=[],s=[],m=[];for(const[c,o]of[[-.5,.55],[0,1],[.5,.55]]){const g=f.length/3;f.push(e,c,0),s.push(.5*o,1*o,.72*o);for(let p=0;p<=24;p++){const y=Math.PI-t+2*t*p/24,a=1-Math.abs(p/24-.5)*1.6;f.push(e*Math.cos(y),c,e*Math.sin(y)),s.push(.04*o*a,.38*o*a,.22*o*a)}for(let p=0;p<24;p++)m.push(g,g+1+p,g+2+p)}const i=new ie;return i.setAttribute("position",new ne(f,3)),i.setAttribute("color",new ne(s,3)),i.setIndex(m),i}function Ee(){const e=document.createElement("canvas");e.width=e.height=128;const t=e.getContext("2d"),u=t.createRadialGradient(64,64,0,64,64,64);u.addColorStop(0,"rgba(255,77,94,0.55)"),u.addColorStop(.35,"rgba(255,77,94,0.18)"),u.addColorStop(1,"rgba(255,77,94,0)"),t.fillStyle=u,t.fillRect(0,0,128,128);const f=new ve(e);return f.colorSpace=ge,f}function Te({model:e,player:t,manifest:u,autoRotate:f,onReady:s}){const m=Re(fe(u.meshes.file)),i=R.useMemo(()=>Ce(m.scene,e,Object.fromEntries(u.meshes.nodes.map(n=>[n.name,n.color]))),[m,e,u]),c=q(n=>n.camera),o=q(n=>n.size),g=q(n=>n.controls),p=R.useRef(!1),y=R.useRef(null),a=R.useRef(null),x=R.useRef(null),T=R.useRef(null),S=R.useRef(null),r=R.useMemo(()=>{const n=i.gantryR;return{ring:new re(n,.85,10,200),edge:new re(n,.4,6,200),fan:He(n,.42),curtain:new me(n,n,1,128,1,!0),ringMat:new Y({color:Q,transparent:!0,opacity:.25,blending:F,depthWrite:!1,toneMapped:!1}),edgeMat:new Y({color:Q,transparent:!0,opacity:0,blending:F,depthWrite:!1,toneMapped:!1}),fanMat:new Y({vertexColors:!0,transparent:!0,opacity:0,blending:F,depthWrite:!1,side:ae,toneMapped:!1}),curtainMat:new Y({color:Q,transparent:!0,opacity:0,blending:F,depthWrite:!1,side:ae,toneMapped:!1}),haloTex:Ee()}},[i.gantryR]);R.useEffect(()=>()=>{for(const n of i.parts)n.geom.dispose(),n.mat.dispose()},[i]),R.useEffect(()=>()=>{r.ring.dispose(),r.edge.dispose(),r.fan.dispose(),r.curtain.dispose(),r.ringMat.dispose(),r.edgeMat.dispose(),r.fanMat.dispose(),r.curtainMat.dispose(),r.haloTex.dispose()},[r]),R.useEffect(()=>{s(i.info)},[i,s]),R.useLayoutEffect(()=>{const n=pe.degToRad(c.fov),M=2*Math.atan(Math.tan(n/2)*(o.width/Math.max(1,o.height))),A=i.radius*.8/Math.sin(Math.min(n,M)/2),b=new k(.48,.4,1).normalize();c.position.copy(b.multiplyScalar(A)),c.near=A/20,c.far=A*6;const d=o.width>700?Math.min(140,o.width*.11):0;d?c.setViewOffset(o.width,o.height,d,0,o.width,o.height):c.clearViewOffset(),c.updateProjectionMatrix(),c.lookAt(0,0,0),g&&(g.target.set(0,0,0),g.minDistance=A*.55,g.maxDistance=A*1.6,g.update())},[i,c,o.width,o.height,g]),R.useEffect(()=>{if(!g)return;g.autoRotate=f&&!p.current,g.autoRotateSpeed=.55;const n=()=>{p.current=!0,g.autoRotate=!1};return g.addEventListener("start",n),()=>g.removeEventListener("start",n)},[g,f]);const O=R.useMemo(()=>new k,[]);ye(n=>{const M=i.shared,A=t.t,b=e.state(A);M.uV.value=b.v,M.uA.value=b.a,M.uTau.value=b.tau,M.uTs.value=b.ts,M.uWaveA.value=b.waveA,M.uWaveV.value=b.waveV,M.uGlow.value=.55*b.v+.4*b.a+(b.waveV>=0?.35*(1-b.waveV):0),M.uTime.value=n.clock.elapsedTime;const d=e.xray(A),E=d.i>=0?e.slabY[d.i]:e.slabY[0],L=E?Math.min(E[0],E[1]):0,z=E?Math.max(E[0],E[1]):0;M.uSlab.value.set(L,z),M.uSlabOn.value=d.on;const W=.5*(L+z),G=Math.max(1,z-L);y.current&&(y.current.position.y=e.ringY(A),r.ringMat.opacity=.2+.8*d.on),a.current&&(a.current.position.y=W,a.current.children[0].position.y=-G/2,a.current.children[1].position.y=G/2,r.edgeMat.opacity=.9*d.on);const B=d.i>=0&&A>=e.x[d.i].xray[0]-.01&&A<=e.x[d.i].xray[1]+.03;if(x.current&&(x.current.visible=B,x.current.position.y=W,x.current.scale.set(1,G,1),x.current.rotation.y=-d.angle,r.fanMat.opacity=.6*d.on),T.current&&(T.current.visible=d.on>.01,T.current.position.y=W,T.current.scale.set(1,G,1),r.curtainMat.opacity=.075*d.on),S.current){O.copy(n.camera.position).normalize().multiplyScalar(-i.radius*.9),S.current.position.copy(O);const N=.55+.45*b.v+.25*d.on;S.current.scale.setScalar(i.radius*(3+.25*b.v)),S.current.material.opacity=N}});const _=i.center;return h.jsxs(h.Fragment,{children:[h.jsx("sprite",{ref:S,renderOrder:-10,children:h.jsx("spriteMaterial",{map:r.haloTex,transparent:!0,depthWrite:!1,blending:F,toneMapped:!1})}),h.jsxs("group",{position:[-_.x,-_.y,-_.z],children:[i.parts.map(n=>h.jsx("mesh",{geometry:n.geom,material:n.mat,renderOrder:n.spec.opacity?2:0},n.spec.name)),h.jsx("mesh",{ref:y,geometry:r.ring,material:r.ringMat,rotation:[Math.PI/2,0,0],position:[_.x,0,_.z]}),h.jsxs("group",{ref:a,position:[_.x,0,_.z],children:[h.jsx("mesh",{geometry:r.edge,material:r.edgeMat,rotation:[Math.PI/2,0,0]}),h.jsx("mesh",{geometry:r.edge,material:r.edgeMat,rotation:[Math.PI/2,0,0]})]}),h.jsx("mesh",{ref:x,geometry:r.fan,material:r.fanMat,position:[_.x,0,_.z],visible:!1}),h.jsx("mesh",{ref:T,geometry:r.curtain,material:r.curtainMat,position:[_.x,0,_.z],visible:!1})]})]})}class Oe extends R.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(t){this.props.onError(String(t?.message??t))}render(){return this.state.failed?null:this.props.children}}function Ge(e){const{active:t,onError:u,...f}=e;return h.jsxs(xe,{className:"hb-canvas",dpr:[1,1.75],frameloop:t?"always":"never",gl:{antialias:!0,alpha:!0,powerPreference:"high-performance"},camera:{fov:30,near:5,far:4e3,position:[0,0,420]},onCreated:({gl:s})=>{s.setClearColor(0,0)},children:[h.jsx("ambientLight",{intensity:.22}),h.jsx("hemisphereLight",{args:["#c9dcff","#2b0a10",.6]}),h.jsx("directionalLight",{position:[-160,230,260],intensity:1.7,color:"#fff3ec"}),h.jsx("directionalLight",{position:[240,-40,-220],intensity:1.1,color:"#38d6ff"}),h.jsx("directionalLight",{position:[60,-220,160],intensity:.45,color:"#ff4d5e"}),h.jsxs(be,{resolution:128,frames:1,children:[h.jsx(X,{form:"rect",intensity:2.4,position:[0,260,160],scale:[320,120,1],color:"#ffffff"}),h.jsx(X,{form:"ring",intensity:1.8,position:[-260,40,60],scale:130,color:"#38d6ff"}),h.jsx(X,{form:"rect",intensity:1.3,position:[260,-60,110],scale:[160,220,1],color:"#ff8a95"})]}),h.jsx(Oe,{onError:u,children:h.jsx(R.Suspense,{fallback:null,children:h.jsx(Te,{...f})})}),h.jsx(we,{makeDefault:!0,enablePan:!1,enableZoom:!1,enableDamping:!0,dampingFactor:.08,minPolarAngle:.35,maxPolarAngle:2.65})]})}export{Ge as default};

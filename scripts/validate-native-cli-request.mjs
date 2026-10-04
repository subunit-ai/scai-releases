#!/usr/bin/env node
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePrRequest} from './verify-source-confidentiality.mjs';
export function validateNativeCliProofMode(mode){
 if(mode!=='success'&&mode!=='late-a-failure-discovery')throw new Error('Invalid native CLI proof mode');
 return mode;
}
export function validateNativeCliRequest(sourceSha,requestId,keyBase64,proofMode='success'){
 validateNativeCliProofMode(proofMode);
 const request=validatePrRequest(sourceSha,requestId);
 if(typeof keyBase64!=='string'||keyBase64.length===0||keyBase64.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(keyBase64))throw new Error('Explicit one-time public recipient required');
 const pem=Buffer.from(keyBase64,'base64').toString('utf8');
 if(!/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\r\n]+\n-----END PUBLIC KEY-----\n?$/.test(pem))throw new Error('Public SPKI PEM only');
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<3072)throw new Error('RSA-3072+ public recipient required');
 return request;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{validateNativeCliRequest(process.env.SOURCE_SHA,process.env.REQUEST_ID,process.env.SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64,process.env.SCAI_NATIVE_CLI_PROOF_MODE);console.log('PASS native-cli-request');}
 catch{console.error('Invalid native CLI request or public recipient');process.exitCode=64;}
}

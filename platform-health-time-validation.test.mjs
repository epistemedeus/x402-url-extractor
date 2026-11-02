import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPlatformHealthCard,platformHealthEvidenceRequiresRefresh} from './platform-health.mjs';
const card=(observed='2026-02-28T00:00:00Z',until='2026-03-05T00:00:00Z')=>({platform_id:'unrelated-synthetic',observed_at:observed,fresh_until:until,current_platform_state:{open_inventory_count:0}});
test('strict calendar and timezone validation rejects normalization as current evidence',()=>{
 for(const value of ['2026-02-30T00:00:00Z','1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-02-28','2026-02-28T00:00:00','2026-02-28T24:00:00Z','2026-02-28T00:00:00+24:00','2026-02-28T00:00:00+00:60']){
  const result=projectPlatformHealthCard(card(value),'2026-03-03T00:00:00Z');
  assert.equal(result.freshness,'not_current',value);assert.equal(result.current_availability.open_inventory_count,null,value);
  assert.equal(platformHealthEvidenceRequiresRefresh(result),true,value);
 }
});
test('invalid expiration and observation window cannot establish a current interval',()=>{
 for(const change of [{fresh_until:'2026-02-30T00:00:00Z'},{window_start:'2026-02-30T00:00:00Z'},{window_end:'2026-03-01T00:00:00'}]){
  const result=projectPlatformHealthCard({...card(),...change},'2026-03-01T00:00:00Z');
  assert.equal(result.freshness,'not_current');assert.equal(platformHealthEvidenceRequiresRefresh(result),true);
 }
});
test('valid offsets and Gregorian leap days preserve fresh zero and exact expiry',()=>{
 for(const observed of ['2026-02-28T08:00:00+08:00','2026-02-27T19:00:00-05:00','2026-02-28t00:00:00.123z']){
  const result=projectPlatformHealthCard(card(observed),'2026-03-01T00:00:00Z');
  assert.equal(result.freshness,'fresh');assert.equal(result.current_availability.open_inventory_count,0);
 }
 for(const year of ['2000','2024','2400'])assert.equal(projectPlatformHealthCard(card(year+'-02-29T00:00:00Z',year+'-03-01T00:00:00Z'),year+'-03-01T00:00:00Z').freshness,'fresh');
});

import assert from "node:assert/strict";
import test from "node:test";
import { getClientMetrics, uniqueAppointments, type ContactTableItem, type ClientAppointment } from "../src/lib/contacts-view.ts";

const now = new Date("2026-10-14T18:00:00Z");
function appointment(id:string,status:string,startTime:string,type="Corte"):ClientAppointment {
    return {id,status,startTime,endTime:startTime,title:type,appointmentType:type,confirmationStatus:"pending",serviceId:null,patientId:null,specialistId:null,notes:null,source:"crm",isOverbook:false,visitMode:"in_person",meetStatus:"none",meetLink:null,remindersOptOut:false,googleCalendarId:null};
}
function contact(appointments:ClientAppointment[]=[]):ContactTableItem {
    return {id:"test",name:"Ana",lastName:null,phone:null,tags:[],createdAt:now,whatsappAvatarUrl:null,appointments,patients:[]};
}
test("client history counts a visit once when linked through both contact and patient",()=>{
    const visit=appointment("shared","completed","2026-10-01T18:00:00Z");
    const data=contact([visit]);
    data.patients=[{id:"patient",appointments:[visit,appointment("legacy","completed","2026-10-02T18:00:00Z")]}];
    assert.equal(uniqueAppointments(data).length,2);
    assert.equal(getClientMetrics(data,now).attendedCount,2);
});
test("client last visit is a completed appointment, not a recent cancellation or a future reservation",()=>{
    const data=contact([appointment("attended","completed","2026-10-01T18:00:00Z"),appointment("canceled","cancelled","2026-10-13T18:00:00Z"),appointment("future","scheduled","2026-10-15T18:00:00Z")]);
    const metrics=getClientMetrics(data,now);
    assert.equal(metrics.lastVisit?.id,"attended");
    assert.equal(metrics.nextAppointment?.id,"future");
    assert.equal(metrics.attendedCount,1);
});
test("the next actionable appointment ignores closed, missed and past appointments",()=>{
    const data=contact([appointment("past","scheduled","2026-10-13T18:00:00Z"),appointment("no-show","no_show","2026-10-15T18:00:00Z"),appointment("completed","completed","2026-10-15T18:00:00Z"),appointment("later","scheduled","2026-10-17T18:00:00Z"),appointment("next","scheduled","2026-10-16T18:00:00Z")]);
    assert.equal(getClientMetrics(data,now).actionAppointment?.id,"next");
});
test("derived tags do not modify saved tags or expose internal entry tags",()=>{
    const data=contact(Array.from({length:5},(_,i)=>appointment(String(i),"completed",`2026-10-0${i+1}T18:00:00Z`)));
    data.tags=["Cliente","entryapp_secret","entry_global_hidden"];
    assert.deepEqual(getClientMetrics(data,now).tags,["Cliente","recurrente","vip"]);
    assert.deepEqual(data.tags,["Cliente","entryapp_secret","entry_global_hidden"]);
});
test("a client without appointments has explicit empty history and no suggested action",()=>{
    const metrics=getClientMetrics(contact(),now);
    assert.equal(metrics.attendedCount,0);
    assert.equal(metrics.lastVisit,null);
    assert.equal(metrics.nextAppointment,null);
    assert.equal(metrics.actionAppointment,null);
});

package vecto.app.car;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VectoCarBridge")
public class VectoCarBridgePlugin extends Plugin {
    public static final String PREFS_NAME = "vecto_car_prefs";
    public static final String KEY_JOBS_JSON = "jobs_json";
    public static final String KEY_ACTIVE_JOB_ID = "active_job_id";
    public static final String KEY_DRIVER_NAME = "driver_name";
    public static final String KEY_COMPANY_NAME = "company_name";
    public static final String KEY_PENDING_ACTION = "pending_action";

    @PluginMethod
    public void syncJobs(PluginCall call) {
        String jobsJson = call.getString("jobs", "[]");
        String activeJobId = call.getString("activeJobId", "");
        String driverName = call.getString("driverName", "");
        String companyName = call.getString("companyName", "");

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_JOBS_JSON, jobsJson)
                .putString(KEY_ACTIVE_JOB_ID, activeJobId)
                .putString(KEY_DRIVER_NAME, driverName)
                .putString(KEY_COMPANY_NAME, companyName)
                .apply();

        call.resolve();
    }

    @PluginMethod
    public void getPendingCarAction(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String actionJson = prefs.getString(KEY_PENDING_ACTION, null);
        if (actionJson != null) {
            prefs.edit().remove(KEY_PENDING_ACTION).apply();
        }
        JSObject ret = new JSObject();
        ret.put("action", actionJson);
        call.resolve(ret);
    }
}

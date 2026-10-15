package vecto.app.car;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Screen displaying the active job queue and stops on the vehicle infotainment center.
 */
public class JobListCarScreen extends Screen {

    public JobListCarScreen(@NonNull CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        SharedPreferences prefs = getCarContext().getSharedPreferences(VectoCarBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String jobsJson = prefs.getString(VectoCarBridgePlugin.KEY_JOBS_JSON, "[]");
        String companyName = prefs.getString(VectoCarBridgePlugin.KEY_COMPANY_NAME, "Vecto");

        JSONArray jobs = new JSONArray();
        try {
            jobs = new JSONArray(jobsJson);
        } catch (Exception ignored) {}

        ActionStrip actionStrip = new ActionStrip.Builder()
                .addAction(new Action.Builder()
                        .setTitle("Refresh")
                        .setOnClickListener(this::invalidate)
                        .build())
                .build();

        if (jobs.length() == 0) {
            return new MessageTemplate.Builder("No active jobs assigned.\nPlease select a job in the Vecto app on your phone.")
                    .setTitle(companyName.isEmpty() ? "Vecto Fleet" : companyName)
                    .setHeaderAction(Action.APP_ICON)
                    .setActionStrip(actionStrip)
                    .build();
        }

        ItemList.Builder itemListBuilder = new ItemList.Builder();
        // Android Auto limits list items while driving to avoid distraction (max 6)
        int maxItems = Math.min(jobs.length(), 6);

        for (int i = 0; i < maxItems; i++) {
            try {
                JSONObject jobObj = jobs.getJSONObject(i);
                final String jobStr = jobObj.toString();
                String title = jobObj.optString("title", "Stop #" + (i + 1));
                String destination = jobObj.optString("destination", "");
                String customer = jobObj.optString("customer", "");
                String status = jobObj.optString("status", "Pending");

                Row.Builder row = new Row.Builder()
                        .setTitle(title)
                        .addText(destination.isEmpty() ? (customer.isEmpty() ? "No address specified" : customer) : destination)
                        .addText("Status: " + status)
                        .setOnClickListener(() -> {
                            getScreenManager().push(new JobDetailCarScreen(getCarContext(), jobStr));
                        });

                itemListBuilder.addItem(row.build());
            } catch (Exception e) {
                // Ignore malformed job item
            }
        }

        return new ListTemplate.Builder()
                .setTitle(companyName.isEmpty() ? "Assigned Jobs" : companyName)
                .setHeaderAction(Action.APP_ICON)
                .setSingleList(itemListBuilder.build())
                .setActionStrip(actionStrip)
                .build();
    }
}

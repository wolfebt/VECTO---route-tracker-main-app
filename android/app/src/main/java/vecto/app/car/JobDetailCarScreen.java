package vecto.app.car;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import org.json.JSONObject;

/**
 * Screen showing individual job details, destination, and quick actions on the vehicle display.
 */
public class JobDetailCarScreen extends Screen {

    private final String jobJsonString;
    private String currentStatus;

    public JobDetailCarScreen(@NonNull CarContext carContext, String jobJsonString) {
        super(carContext);
        this.jobJsonString = jobJsonString;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        JSONObject job = new JSONObject();
        try {
            job = new JSONObject(jobJsonString);
        } catch (Exception ignored) {}

        final String jobId = job.optString("id", "");
        final String title = job.optString("title", "Job Details");
        final String destination = job.optString("destination", "");
        final String customer = job.optString("customer", "");
        final String notes = job.optString("notes", "");
        final String phone = job.optString("phone", "");
        if (currentStatus == null) {
            currentStatus = job.optString("status", "Pending");
        }

        Pane.Builder paneBuilder = new Pane.Builder();

        if (!destination.isEmpty()) {
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Destination")
                    .addText(destination)
                    .build());
        }

        if (!customer.isEmpty()) {
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Customer / Contact")
                    .addText(customer)
                    .build());
        }

        paneBuilder.addRow(new Row.Builder()
                .setTitle("Status")
                .addText(currentStatus)
                .build());

        if (!notes.isEmpty()) {
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Instructions & Notes")
                    .addText(notes)
                    .build());
        }

        // Action 1: Turn-by-Turn Navigation
        if (!destination.isEmpty()) {
            paneBuilder.addAction(new Action.Builder()
                    .setTitle("Navigate")
                    .setBackgroundColor(CarColor.BLUE)
                    .setOnClickListener(() -> {
                        try {
                            Intent navIntent = new Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:0,0?q=" + Uri.encode(destination)));
                            getCarContext().startCarApp(navIntent);
                        } catch (Exception e) {
                            CarToast.makeText(getCarContext(), "Could not launch car navigation", CarToast.LENGTH_SHORT).show();
                        }
                    })
                    .build());
        }

        // Action 2: Update Status (Arrived / Complete)
        final String nextStatus = currentStatus.equalsIgnoreCase("In Progress") ? "Completed" : "In Progress";
        final String buttonLabel = currentStatus.equalsIgnoreCase("In Progress") ? "Mark Completed" : "Mark Arrived";

        paneBuilder.addAction(new Action.Builder()
                .setTitle(buttonLabel)
                .setBackgroundColor(CarColor.GREEN)
                .setOnClickListener(() -> {
                    currentStatus = nextStatus;
                    try {
                        SharedPreferences prefs = getCarContext().getSharedPreferences(VectoCarBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
                        JSONObject actionObj = new JSONObject();
                        actionObj.put("type", "update_job_status");
                        actionObj.put("jobId", jobId);
                        actionObj.put("status", nextStatus);
                        prefs.edit().putString(VectoCarBridgePlugin.KEY_PENDING_ACTION, actionObj.toString()).apply();
                        CarToast.makeText(getCarContext(), "Status updated: " + nextStatus, CarToast.LENGTH_SHORT).show();
                    } catch (Exception ignored) {}
                    invalidate();
                })
                .build());

        // Action 3: Hands-Free Phone Call
        if (!phone.isEmpty()) {
            paneBuilder.addAction(new Action.Builder()
                    .setTitle("Call Customer")
                    .setOnClickListener(() -> {
                        try {
                            Intent callIntent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone));
                            getCarContext().startCarApp(callIntent);
                        } catch (Exception e) {
                            CarToast.makeText(getCarContext(), "Could not launch dialer", CarToast.LENGTH_SHORT).show();
                        }
                    })
                    .build());
        }

        return new PaneTemplate.Builder(paneBuilder.build())
                .setTitle(title)
                .setHeaderAction(Action.BACK)
                .build();
    }
}

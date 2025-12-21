// scholar_stream_db
// q1i72QgjY6hBbJHO

const express = require('express')
const cors = require('cors')
const app = express()

require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000


// Firebase admin SDK
const admin = require("firebase-admin");

const serviceAccount = require("./scholarstream-firebase-admin-sdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(express.json());
app.use(cors());

const VerifyFirebaseToken = async (req, res, next) => {
    // console.log('headers in middle ware', req.headers?.authorization)
    const Token = req.headers.authorization;

    if (!Token) {
        return res.status(401).send({ message: 'Unauthorized access' })
    }
    try {
        const tokenId = Token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(tokenId);
        console.log('Decoded in the token', decoded);
        req.decoded_email = decoded.email;

        next()
    }
    catch (err) {
        return res.status(401).send({ message: "Unauthorized access" });
    }
}


const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_pass}@cluster0.mcccn4v.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('scholar_stream_db');
        const scholarshipsCollection = db.collection('scholarships');
        const reviewsCollection = db.collection('reviews');
        const usersCollection = db.collection('users');
        const paymentCollection = db.collection('payments');
        const applicationsCollection = db.collection('applications');

        // middleWare with database access >> admin before allowing admin activity
        // Must be used after VerifyFirebaseToken middleWare
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                res.send({ message: "Forbidden access" })
            }

            next()
        }

        const verifyModerator = async (req, res, next) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || (user.role !== 'moderator' && user.role !== 'admin')) {
                return res.status(403).send({ message: "Forbidden" });
            }
            next();
        };


        // API's here

        // User Related API's

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };

            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already exists" });
            }

            user.role = "student";
            user.createdAt = new Date();
            user.status = "active";

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/:email/role', VerifyFirebaseToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'student' });
        });

        // Get current logged-in user info
        app.get('/users/me', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });
            res.send(user);
        });

        app.patch('/users/role/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send(result);
        });

        app.delete('/users/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await usersCollection.deleteOne({
                _id: new ObjectId(id)
            });

            res.send(result);
        });

        // Analytics related api
        app.get('/admin/analytics', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const totalUsers = await usersCollection.estimatedDocumentCount();
            const totalScholarships = await scholarshipsCollection.estimatedDocumentCount();

            const payments = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalFees: { $sum: "$amount" } // ✅ correct field
                    }
                }
            ]).toArray();

            res.send({
                totalUsers,
                totalScholarships,
                totalFees: payments[0]?.totalFees || 0
            });
        });


        // GET /admin/application-stats
        app.get('/admin/application-stats', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const stats = await scholarshipsCollection.aggregate([
                {
                    $group: {
                        _id: "$scholarshipCategory",
                        applications: { $sum: "$appliedCount" } // ✅ real application count
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: "$_id",
                        applications: 1
                    }
                }
            ]).toArray();

            res.send(stats);
        });


        //    Scholarship Related API's

        app.get('/scholarships', async (req, res) => {
            try {
                const { search, category, subject, degree, page = 1, limit = 17 } = req.query;

                const query = {};
                if (search) {
                    query.$or = [
                        { scholarshipName: { $regex: search, $options: 'i' } },
                        { universityName: { $regex: search, $options: 'i' } },
                        { degree: { $regex: search, $options: 'i' } },
                    ];
                }
                if (category) query.scholarshipCategory = category;
                if (subject) query.subjectCategory = subject;
                if (degree) query.degree = degree;

                // প্যাগিনেশনের হিসাব
                const skip = (parseInt(page) - 1) * parseInt(limit);

                // মোট কয়টি ডেটা আছে তা বের করা (ফ্রন্টএন্ডে বাটন দেখানোর জন্য লাগবে)
                const totalItems = await scholarshipsCollection.countDocuments(query);

                const result = await scholarshipsCollection.find(query)
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray();

                res.send({
                    scholarships: result,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit),
                    currentPage: parseInt(page)
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/top', async (req, res) => {
            try {
                const result = await scholarshipsCollection
                    .find()
                    .sort({ applicationFees: 1 })
                    .limit(6)
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await scholarshipsCollection.findOne(query);
            res.send(result);
        });

        app.post('/scholarships', async (req, res) => {
            try {
                const scholarship = req.body;
                const result = await scholarshipsCollection.insertOne(scholarship);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to add scholarship" });
            }
        });

        app.delete("/scholarships/:id", async (req, res) => {
            const id = req.params.id;

            const result = await scholarshipsCollection.deleteOne({
                _id: new ObjectId(id),
            });

            res.send(result);
        });

        app.patch("/scholarships/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await scholarshipsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            res.send(result);
        });


        // Payment Related API's

        // no 1

        // app.post('/create-checkout-session', VerifyFirebaseToken, async (req, res) => {
        //     const { scholarshipId } = req.body;

        //     const scholarship = await scholarshipsCollection.findOne({
        //         _id: new ObjectId(scholarshipId)
        //     });

        //     if (!scholarship) {
        //         return res.status(404).send({ message: "Scholarship not found" });
        //     }

        //     const amount =
        //         (scholarship.applicationFees + scholarship.serviceCharge) * 100;

        //     const session = await stripe.checkout.sessions.create({
        //         payment_method_types: ['card'],
        //         line_items: [
        //             {
        //                 price_data: {
        //                     currency: 'usd',
        //                     unit_amount: amount,
        //                     product_data: {
        //                         name: scholarship.scholarshipName,
        //                         description: scholarship.universityName
        //                     }
        //                 },
        //                 quantity: 1
        //             }
        //         ],
        //         customer_email: req.decoded_email,
        //         mode: 'payment',
        //         metadata: {
        //             scholarshipId: scholarship._id.toString(),
        //             scholarshipName: scholarship.scholarshipName
        //         },
        //         success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        //         cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
        //     });

        //     res.send({ url: session.url });
        // });

        // no 2

        app.post('/create-checkout-session', VerifyFirebaseToken, async (req, res) => {
            try {
                const { scholarshipId, userName, userEmail, universityName, scholarshipName } = req.body;

                // ১. স্কলারশিপের তথ্য চেক করা
                const scholarship = await scholarshipsCollection.findOne({
                    _id: new ObjectId(scholarshipId)
                });

                if (!scholarship) {
                    return res.status(404).send({ message: "Scholarship not found" });
                }

                // ২. ক্লিক করার সাথে সাথে applicationsCollection-এ একটি 'pending' এন্ট্রি তৈরি
                const initialApplication = {
                    scholarshipId: new ObjectId(scholarshipId),
                    scholarshipName: scholarship.scholarshipName,
                    universityName: scholarship.universityName,
                    userName: userName, // ফ্রন্টএন্ড থেকে পাঠানো
                    userEmail: userEmail || req.decoded_email, // সেফটির জন্য দুইটাই চেক করা
                    amountPaid: 0,
                    paymentStatus: "pending", // পেমেন্ট না হওয়া পর্যন্ত এটি পেন্ডিং থাকবে
                    status: "pending", // মডারেটর স্ট্যাটাস
                    appliedAt: new Date(),
                    feedback: ""
                };

                const applicationResult = await applicationsCollection.insertOne(initialApplication);
                const applicationId = applicationResult.insertedId;

                // ৩. স্ট্রাইপ সেশন তৈরি
                const amount = (scholarship.applicationFees + scholarship.serviceCharge) * 100;

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                unit_amount: amount,
                                product_data: {
                                    name: scholarship.scholarshipName,
                                    description: scholarship.universityName
                                }
                            },
                            quantity: 1
                        }
                    ],
                    customer_email: req.decoded_email,
                    mode: 'payment',
                    metadata: {
                        applicationId: applicationId.toString(), // পেমেন্ট সাকসেস রুটে এটি লাগবে
                        scholarshipId: scholarshipId.toString(),
                        scholarshipName: scholarship.scholarshipName
                    },
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
                });

                res.send({ url: session.url });
            } catch (error) {
                console.error("Stripe Session Error:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // no 1
        // app.patch('/scholarship-payment-success', async (req, res) => {
        //     const sessionId = req.query.session_id;
        //     const session = await stripe.checkout.sessions.retrieve(sessionId);

        //     if (session.payment_status !== 'paid') {
        //         return res.send({ success: false });
        //     }

        //     const scholarshipId = session.metadata.scholarshipId;
        //     const transactionId = session.payment_intent;

        //     // Prevent duplicate
        //     const exists = await paymentCollection.findOne({ transactionId });
        //     if (exists) {
        //         return res.send({ message: "Already Paid" });
        //     }

        //     // 1️⃣ Save payment
        //     await paymentCollection.insertOne({
        //         scholarshipId,
        //         scholarshipName: session.metadata.scholarshipName,
        //         userEmail: session.customer_email,
        //         amount: session.amount_total / 100,
        //         transactionId,
        //         paymentStatus: "paid",
        //         paidAt: new Date(),
        //     });

        //     // 2️⃣ Update scholarship
        //     await scholarshipsCollection.updateOne(
        //         { _id: new ObjectId(scholarshipId) },
        //         {
        //             $push: {
        //                 applications: {
        //                     userEmail: session.customer_email,
        //                     transactionId,
        //                     amountPaid: session.amount_total / 100,
        //                     paymentStatus: "paid",
        //                     appliedAt: new Date()
        //                 }
        //             },
        //             $inc: {
        //                 appliedCount: 1,
        //                 totalFeesCollected: session.amount_total / 100
        //             }
        //         }
        //     );

        //     res.send({ success: true, transactionId });
        // });

        // no 2 

        // app.patch('/scholarship-payment-success', async (req, res) => {
        //     const sessionId = req.query.session_id;
        //     const session = await stripe.checkout.sessions.retrieve(sessionId);

        //     if (session.payment_status !== 'paid') {
        //         return res.send({ success: false });
        //     }

        //     const { scholarshipId, scholarshipName, userName, universityName } = session.metadata;
        //     console.log(session)
        //     const transactionId = session.payment_intent;

        //     const exists = await applicationsCollection.findOne({ transactionId });
        //     if (exists) return res.send({ message: "Already Processed" });

        //     // ১. আলাদা applicationsCollection এ ডেটা ইনসার্ট করা
        //     const applicationData = {
        //         scholarshipId: new ObjectId(scholarshipId),
        //         scholarshipName,
        //         universityName,
        //         userName, // from metadata
        //         userEmail: session.student_email,
        //         amountPaid: session.amount_total / 100,
        //         transactionId,
        //         paymentStatus: "paid",
        //         status: "pending", // Default status
        //         appliedAt: new Date(),
        //         feedback: ""
        //     };

        //     await applicationsCollection.insertOne(applicationData);

        //     // ২. আগের মতো স্কলারশিপ কাউন্ট আপডেট করা (ঐচ্ছিক কিন্তু ভালো)
        //     await scholarshipsCollection.updateOne(
        //         { _id: new ObjectId(scholarshipId) },
        //         { $inc: { appliedCount: 1 } }
        //     );

        //     res.send({ success: true, transactionId });
        // });

        // no 3
        app.patch('/scholarship-payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const { applicationId, scholarshipId, scholarshipName } = session.metadata;
                const transactionId = session.payment_intent;
                const amountPaid = session.amount_total / 100;

                // ১. ওই নির্দিষ্ট অ্যাপ্লিকেশনটি আপডেট করুন
                await applicationsCollection.updateOne(
                    { _id: new ObjectId(applicationId) },
                    {
                        $set: {
                            paymentStatus: "paid",
                            transactionId: transactionId,
                            amountPaid: session.amount_total / 100,
                            paidAt: new Date()
                        }
                    }
                );

                // ২. স্কলারশিপের কাউন্ট বাড়ানো
                await scholarshipsCollection.updateOne(
                    { _id: new ObjectId(scholarshipId) },
                    { $inc: { appliedCount: 1 } }
                );

                // res.send({ success: true });
                res.send({
                    success: true,
                    transactionId,
                    scholarshipName, // From metadata 
                    universityName: session.metadata.universityName || "University",
                    amountPaid
                });
            }
        });


        app.get('/payments', VerifyFirebaseToken, async (req, res) => {
            const email = req.query.email;
            const query = {};
            // console.log('Header &&', req.headers)
            if (email) {
                query.userEmail = email;

                // Check email address

                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: "Forbidden access" })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result)
        })

        app.delete('/payments', async (req, res) => {
            // const id = req.params.id;
            // const query = { _id: new ObjectId(id) };

            const result = await paymentCollection.deleteMany();
            res.send(result);
        })

        app.delete('/payments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await paymentCollection.deleteOne(query);
            res.send(result);
        })

        // Application >> moderator

        app.get('/moderator/applications', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            // শুধুমাত্র পেমেন্ট করা আবেদনগুলো মডারেটর দেখবে
            const query = { paymentStatus: "paid" };
            const result = await applicationsCollection.find(query).sort({ appliedAt: -1 }).toArray();
            res.send(result);
        });

        // to see all applications
        // app.get('/moderator/applications', VerifyFirebaseToken, verifyModerator, async (req, res) => {
        //     const cursor = applicationsCollection.find().sort({ appliedAt: -1 })
        //     const result = await cursor.toArray();
        //     res.send(result);
        // });

        // to update status through application id
        // app.patch('/moderator/application-status/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
        //     const id = req.params.id;
        //     const { status } = req.body;
        //     const result = await applicationsCollection.updateOne(
        //         { _id: new ObjectId(id) },
        //         { $set: { status: status } }
        //     );
        //     res.send(result);
        // });

        // // to update feedback through id
        // app.patch('/moderator/application-feedback/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
        //     const id = req.params.id;
        //     const { feedback } = req.body;
        //     const result = await applicationsCollection.updateOne(
        //         { _id: new ObjectId(id) },
        //         { $set: { feedback: feedback } }
        //     );
        //     res.send(result);
        // });


        // ১. অ্যাপ্লিকেশনের স্ট্যাটাস (Processing, Completed, Rejected) আপডেট করার জন্য
        app.patch('/moderator/application-status/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            try {
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: status } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Application not found" });
                }

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // ২. অ্যাপ্লিকেশনের ফিডব্যাক আপডেট করার জন্য
        app.patch('/moderator/application-feedback/:id', VerifyFirebaseToken, verifyModerator, async (req, res) => {
            const id = req.params.id;
            const { feedback } = req.body;

            try {
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { feedback: feedback } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Application not found" });
                }

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // Reviews Related API's

        // app.get('/reviews', async (req, res) => {
        //     try {
        //         const { scholarshipId } = req.query;

        //         if (!scholarshipId) {
        //             return res.status(400).send({ message: "scholarshipId is required" });
        //         }
        //         const query = { scholarship_id: scholarshipId };

        //         const reviews = await reviewsCollection
        //             .find(query)
        //             .sort({ createdAt: -1 })
        //             .toArray();

        //         res.send(reviews);
        //     } catch (error) {
        //         console.error("Reviews fetch error:", error);
        //         res.status(500).send({ message: "Failed to fetch reviews" });
        //     }
        // });

        app.get('/reviews', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;
            // const user = await usersCollection.findOne({ email });

            // if (!user || (user.role !== "admin" && user.role !== "moderator")) {
            //     return res.status(403).send({ message: "Forbidden" });
            // }

            const reviews = await reviewsCollection
                .find()
                .sort({ createdAt: -1 })
                .toArray();

            res.send(reviews);
        });


        // app.post('/reviews', async (req, res) => {
        //     try {
        //         const review = req.body;
        //         review.createdAt = new Date();

        //         const result = await reviewsCollection.insertOne(review);
        //         res.send(result);
        //     } catch (error) {
        //         console.error(error);
        //         res.status(500).send({ message: "Failed to add review" });
        //     }
        // });

        app.post('/reviews', VerifyFirebaseToken, async (req, res) => {
            try {
                const {
                    scholarshipId,
                    scholarshipName,
                    reviewComment,
                    rating
                } = req.body;

                const email = req.decoded_email;
                const user = await usersCollection.findOne({ email });

                const reviewDoc = {
                    scholarshipId,
                    scholarshipName,
                    reviewerEmail: email,
                    reviewerName: user.name,
                    reviewerPhoto: user.photo,
                    reviewComment,
                    rating: rating || null,
                    createdAt: new Date()
                };

                const result = await reviewsCollection.insertOne(reviewDoc);
                res.send(result);

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to add review" });
            }
        });

        app.delete('/reviews/:id', VerifyFirebaseToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });

            if (!user || (user.role !== "admin" && user.role !== "moderator")) {
                return res.status(403).send({ message: "Forbidden" });
            }

            const id = req.params.id;
            const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });






        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Scholar Stream is streaming now !')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
